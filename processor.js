/**
 * Core image processing logic.
 * We use OffscreenCanvas logic or standard Canvas API.
 */

export async function processImages(sourceUrl, targetUrl) {
    const size = 512; // Standardize processing size for performance
    
    // 1. Load images into bitmaps/canvas data
    const sourceData = await getImageData(sourceUrl, size);
    const targetData = await getImageData(targetUrl, size);

    // 2. Algorithm 1: Source Pixels -> Target Structure
    // We want the image to look like Target, but use ONLY Source pixels.
    const algo1Blob = await runPixelSort(sourceData, targetData, size);

    // 3. Algorithm 2: Target Pixels -> Source Structure
    // We want the image to look like Source, but use ONLY Target pixels.
    const algo2Blob = await runPixelSort(targetData, sourceData, size);

    return {
        algo1Blob,
        algo2Blob
    };
}

async function getImageData(url, size) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            const imageData = ctx.getImageData(0, 0, size, size);
            resolve(imageData);
        };
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * Reconstructs 'structureData' using exact pixels from 'paletteData'.
 */
async function runPixelSort(paletteData, structureData, size) {
    // 1. Extract all pixels from the palette source
    // Each pixel is {r, g, b, brightness}
    const palettePixels = [];
    const pData = paletteData.data;
    for (let i = 0; i < pData.length; i += 4) {
        const r = pData[i];
        const g = pData[i+1];
        const b = pData[i+2];
        // Luminance calculation
        const lum = 0.299*r + 0.587*g + 0.114*b; 
        palettePixels.push({ r, g, b, lum });
    }

    // 2. Extract structure targets with positions
    // Each target is {lum, index}
    const structureTargets = [];
    const sData = structureData.data;
    for (let i = 0; i < sData.length; i += 4) {
        const r = sData[i];
        const g = sData[i+1];
        const b = sData[i+2];
        const lum = 0.299*r + 0.587*g + 0.114*b;
        structureTargets.push({ lum, index: i });
    }

    // 3. Sort both arrays by luminance
    // This aligns the darkest pixel from palette to the darkest spot in structure
    palettePixels.sort((a, b) => a.lum - b.lum);
    structureTargets.sort((a, b) => a.lum - b.lum);

    // 4. Create new buffer
    const resultBuffer = new Uint8ClampedArray(sData.length);
    
    // Fill alpha to 255
    for(let i=3; i<resultBuffer.length; i+=4) resultBuffer[i] = 255;

    // 5. Map pixels
    for (let i = 0; i < palettePixels.length; i++) {
        const pixel = palettePixels[i];
        const targetPos = structureTargets[i].index; // The original index in the image array
        
        resultBuffer[targetPos] = pixel.r;
        resultBuffer[targetPos+1] = pixel.g;
        resultBuffer[targetPos+2] = pixel.b;
        // Alpha is already 255
    }

    // 6. Convert back to blob
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const newImageData = new ImageData(resultBuffer, size, size);
    ctx.putImageData(newImageData, 0, 0);

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}