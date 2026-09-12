import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = await readFile(new URL("../public/favicon.svg", import.meta.url));
const icons = [
  [192, new URL("../public/icon-192.png", import.meta.url)],
  [512, new URL("../public/icon-512.png", import.meta.url)],
  [180, new URL("../public/apple-touch-icon.png", import.meta.url)]
];

await Promise.all(icons.map(([size, output]) =>
  sharp(source)
    .resize(Number(size), Number(size))
    .png({ compressionLevel: 9, palette: true })
    .toFile(fileURLToPath(output))
));
