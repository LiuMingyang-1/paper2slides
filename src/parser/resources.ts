const cmaps = import.meta.glob<string>("../../node_modules/pdfjs-dist/cmaps/*.bcmap", {
  eager: true, import: "default", query: "?url&inline",
});
const standardFonts = import.meta.glob<string>("../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}", {
  eager: true, import: "default", query: "?url&inline",
});

function decode(url: string | undefined): Uint8Array {
  if (!url?.startsWith("data:")) throw new Error("Missing bundled PDF resource");
  const encoded = url.slice(url.indexOf(",") + 1);
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

// PDF.js calls these factories from the main thread. Decode the data URLs directly so
// connect-src 'self' also works on platforms that disallow fetching data: URLs.
export class BundledCMapReader {
  async fetch({ name }: { name: string }) {
    return { cMapData: decode(cmaps[`../../node_modules/pdfjs-dist/cmaps/${name}.bcmap`]), isCompressed: true };
  }
}

export class BundledStandardFontReader {
  async fetch({ filename }: { filename: string }) {
    return decode(standardFonts[`../../node_modules/pdfjs-dist/standard_fonts/${filename}`]);
  }
}
