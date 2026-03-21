import { initializeImageMagick, ImageMagick, MagickFormat } from "@imagemagick/magick-wasm";
import { dump, insert, ImageIFD } from "piexifjs";

import {
  binaryStringToBytes,
  bytesToBinaryString,
} from "@web-speed-hackathon-2026/client/src/utils/binary";

interface Options {
  extension: MagickFormat;
}

let magickWasmPromise: Promise<ArrayBuffer> | null = null;
let initializedImageMagickPromise: Promise<void> | null = null;

async function getImageMagickWasm(): Promise<ArrayBuffer> {
  if (magickWasmPromise != null) {
    return magickWasmPromise;
  }

  magickWasmPromise = fetch("/wasm/magick.wasm", { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load magick.wasm: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .catch((error: unknown) => {
      magickWasmPromise = null;
      throw error;
    });

  return magickWasmPromise;
}

async function initializeImageMagickOnce() {
  if (initializedImageMagickPromise != null) {
    return initializedImageMagickPromise;
  }

  initializedImageMagickPromise = getImageMagickWasm()
    .then((magickWasm) => initializeImageMagick(magickWasm))
    .catch((error: unknown) => {
      initializedImageMagickPromise = null;
      throw error;
    });

  return initializedImageMagickPromise;
}

export async function convertImage(file: File, options: Options): Promise<Blob> {
  await initializeImageMagickOnce();

  const byteArray = new Uint8Array(await file.arrayBuffer());

  return new Promise((resolve, reject) => {
    try {
      ImageMagick.read(byteArray, (img) => {
        try {
          img.format = options.extension;
          const comment = img.comment;

          img.write((output) => {
            try {
              if (comment == null) {
                resolve(new Blob([output as Uint8Array<ArrayBuffer>]));
                return;
              }

              // ImageMagick では EXIF の ImageDescription フィールドに保存されているデータが
              // 非標準の Comment フィールドに移されてしまうため
              // piexifjs を使って ImageDescription フィールドに書き込む
              const binary = bytesToBinaryString(output as Uint8Array<ArrayBuffer>);
              const descriptionBinary = bytesToBinaryString(new TextEncoder().encode(comment));
              const exifStr = dump({ "0th": { [ImageIFD.ImageDescription]: descriptionBinary } });
              const outputWithExif = insert(exifStr, binary);
              const outputBytes = binaryStringToBytes(outputWithExif);
              const outputBuffer = new ArrayBuffer(outputBytes.byteLength);
              new Uint8Array(outputBuffer).set(outputBytes);
              resolve(new Blob([outputBuffer]));
            } catch (error) {
              reject(error);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
