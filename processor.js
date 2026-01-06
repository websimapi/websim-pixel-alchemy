/**
 * Core image processing logic with visualization.
 */

export async function processImages(sourceUrl, targetUrl, visualizeCtx) {
    const size = 512;
    
    // 1. Load images
    const sourceData = await getImageData(sourceUrl, size);
    if (visualizeCtx) {
        visualizeCtx.putImageData(sourceData, 0, 0);
        await sleep(500); // Pause to show source
    }

    const targetData = await getImageData(targetUrl, size);
    if (visualizeCtx) {
        visualizeCtx.putImageData(targetData, 0, 0);
        await sleep(500); // Pause to show target
    }

    // 2. Algorithm 1: Source Pixels -> Target Structure
    const algo1Blob = await runPixelSort(sourceData, targetData, size, visualizeCtx);
    
    if (visualizeCtx) await sleep(500);

    // 3. Algorithm 2: Target Pixels -> Source Structure
    const algo2Blob = await runPixelSort(targetData, sourceData, size, visualizeCtx);

    return {
        algo1Blob,
        algo2Blob
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function runPixelSort(paletteData, structureData, size, visualizeCtx) {
    // 1. Extract palette pixels
    const palettePixels = [];
    const pData = paletteData.data;
    for (let i = 0; i < pData.length; i += 4) {
        const r = pData[i];
        const g = pData[i+1];
        const b = pData[i+2];
        const lum = 0.299*r + 0.587*g + 0.114*b; 
        palettePixels.push({ r, g, b, lum });
    }

    // 2. Extract structure targets
    const structureTargets = [];
    const sData = structureData.data;
    for (let i = 0; i < sData.length; i += 4) {
        const r = sData[i];
        const g = sData[i+1];
        const b = sData[i+2];
        const lum = 0.299*r + 0.587*g + 0.114*b;
        structureTargets.push({ lum, index: i });
    }

    // 3. Sort
    palettePixels.sort((a, b) => a.lum - b.lum);
    structureTargets.sort((a, b) => a.lum - b.lum);

    // 4. Create new buffer
    // Initialize with transparent or black
    const resultBuffer = new Uint8ClampedArray(sData.length);
    for(let i=3; i<resultBuffer.length; i+=4) resultBuffer[i] = 255;

    // 5. Map pixels with visualization
    // We will render chunks
    const chunkSize = 20000; // Pixels per frame
    
    // We need a temp ImageData for visualization updates to avoid creating it 1000 times?
    // Actually putting ImageData is fast enough for small chunks?
    // Better: keep a running ImageData wrapper around resultBuffer
    
    const visualData = new ImageData(resultBuffer, size, size);

    for (let i = 0; i < palettePixels.length; i++) {
        const pixel = palettePixels[i];
        const targetPos = structureTargets[i].index;
        
        resultBuffer[targetPos] = pixel.r;
        resultBuffer[targetPos+1] = pixel.g;
        resultBuffer[targetPos+2] = pixel.b;
        
        if (visualizeCtx && i % chunkSize === 0) {
            visualizeCtx.putImageData(visualData, 0, 0);
            await new Promise(r => requestAnimationFrame(r));
        }
    }
    
    // Final draw
    if (visualizeCtx) {
        visualizeCtx.putImageData(visualData, 0, 0);
    }

    // 6. Convert to Blob
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(visualData, 0, 0);

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}