import pdfParse from 'pdf-parse';
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist';
import { PNG } from 'pngjs';
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
export async function extractPdfText(pdfBytes) {
    const data = await pdfParse(pdfBytes);
    const pageCount = typeof data.numpages === 'number' ? data.numpages : null;
    return { text: data.text ?? '', pageCount };
}
export async function extractPdfImages(pdfBytes) {
    const doc = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
    const images = [];
    let imgIndex = 0;
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
        const page = await doc.getPage(pageNum);
        const opList = await page.getOperatorList();
        // Collect image XObjects from operator list
        for (let i = 0; i < opList.fnArray.length; i += 1) {
            const fn = opList.fnArray[i];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject)
                continue;
            const args = opList.argsArray[i];
            const name = Array.isArray(args) && args.length > 0 ? args[0] : null;
            if (typeof name !== 'string')
                continue;
            // pdf.js internal: page.objs.get(name, callback)
            const img = await new Promise((resolve) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                page.objs.get(name, (val) => resolve(val));
            });
            const rec = (typeof img === 'object' && img !== null) ? img : null;
            if (!rec)
                continue;
            const data = rec.data;
            const width = rec.width;
            const height = rec.height;
            if (!(data instanceof Uint8ClampedArray) && !(data instanceof Uint8Array))
                continue;
            if (typeof width !== 'number' || typeof height !== 'number')
                continue;
            // Convert raw RGBA to PNG
            const png = new PNG({ width, height });
            png.data = Buffer.from(data);
            const pngBytes = PNG.sync.write(png);
            images.push({
                index: imgIndex,
                page: pageNum,
                mimeType: 'image/png',
                bytes: Buffer.from(pngBytes),
            });
            imgIndex += 1;
        }
    }
    return { images };
}
