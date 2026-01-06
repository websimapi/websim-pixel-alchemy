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

    // 4. Algorithm 3: Falling Sand Transition Video
    // We don't visualize this one on the main canvas to avoid blocking, 
    // or we could, but let's do it internally and return the blob.
    const videoBlob = await createFallingSandVideo(sourceData, targetData, size);

    return {
        algo1Blob,
        algo2Blob,
        videoBlob
    };
}

/**
 * Creates a video where different pixels fall from top into place.
 */
async function createFallingSandVideo(sourceData, targetData, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Draw initial state (Source)
    ctx.putImageData(sourceData, 0, 0);

    // Identify particles
    // Particles are pixels that differ significantly between source and target
    const particles = [];
    const threshold = 30; // Color difference threshold
    
    // Using typed arrays for performance
    const s = sourceData.data;
    const t = targetData.data;
    
    // We'll process in a way that allows us to draw fast
    // Let's optimize: pre-calculate particles
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const rDiff = Math.abs(s[i] - t[i]);
            const gDiff = Math.abs(s[i+1] - t[i+1]);
            const bDiff = Math.abs(s[i+2] - t[i+2]);
            
            if (rDiff + gDiff + bDiff > threshold) {
                // This pixel changes
                particles.push({
                    x: x,
                    targetY: y,
                    y: -Math.random() * size * 1.5, // Start above screen
                    r: t[i],
                    g: t[i+1],
                    b: t[i+2],
                    speed: 2 + Math.random() * 5
                });
            }
        }
    }

    // Setup MediaRecorder
    const stream = canvas.captureStream(30); // 30 FPS
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    const chunks = [];
    
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    const recordingPromise = new Promise(resolve => {
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            resolve(blob);
        };
    });

    recorder.start();

    // Animation Loop
    // We need to render frames until all particles have landed
    // To keep it performant, we manipulate a buffer, but simple rect drawing might be okay for 30fps recording
    
    // Optimization: Draw static background once (Source)
    // Actually, we want the target to build up. 
    // So we keep the source background, and draw particles on top.
    // Once a particle lands, it should stick.
    // We can simulate this by drawing to the main canvas and not clearing, 
    // BUT we need to clear the *moving* particles each frame without clearing the *landed* ones.
    
    // Strategy:
    // Layer 1: Persistent Canvas (Background + Landed particles)
    // Layer 2: Moving particles (cleared every frame) -- simulated by saving ImageData
    
    let activeParticles = particles;
    let frames = 0;
    const maxFrames = 300; // Cap at 10 seconds max to prevent infinite loops
    
    // Pre-fill background with Source
    // It's already there from ctx.putImageData(sourceData, 0, 0);

    // We can't easily layer with just one 2D context without save/restore or manual pixel manip.
    // Let's use direct pixel manipulation on the canvas ImageData.
    
    const currentImageData = ctx.getImageData(0, 0, size, size);
    const buf32 = new Uint32Array(currentImageData.data.buffer);
    
    // Helper to set pixel color in Uint32 buffer (Little Endian: ABGR)
    // Alpha is always 255 (0xFF)
    const setPixel = (i, r, g, b) => {
        buf32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    };

    while (activeParticles.length > 0 && frames < maxFrames) {
        frames++;
        
        // Restore background (the accumulated state)
        // Actually, "restoring" is expensive if we copy the whole buffer.
        // Instead, let's just 'erase' the particles from their PREVIOUS position? 
        // No, that's hard because we don't know what was behind them (could be source or already landed particle).
        
        // Better approach for recording:
        // Use a persistent canvas for the "World" state.
        // Copy World to Temp. Draw particles on Temp. Put Temp on Context.
        
        // This might be slow for JS.
        // Let's just draw 1x1 rectangles for particles. It's actually faster than full `putImageData` 30 times a second on some browsers if count is high?
        // No, 200k rect calls is slow. 
        // `putImageData` is best.
        
        // Optimization:
        // 1. We have `staticBuffer` (Source + Landed stuff).
        // 2. We copy `staticBuffer` to `frameBuffer`.
        // 3. We draw active particles onto `frameBuffer`.
        // 4. We put `frameBuffer`.
        // 5. Update particles. If landed, write to `staticBuffer`.
        
        // Since we are inside an async function not tied to screen refresh rate (except for captureStream), 
        // we can just run the loop. `captureStream` grabs frames when it can. 
        // To ensure smooth video, we should await a small delay to let the recorder capture?
        // Actually `captureStream` is real-time. We must throttle the loop to match ~30fps real-time execution 
        // or the video will be super fast or skip frames.
        
        const frameStart = performance.now();

        // 1. Create a view of the current static state
        // We can just keep `currentImageData` as the "Static + Moving" combined state if we carefully undo moving?
        // No, copy is safer.
        const frameData = new Uint8ClampedArray(currentImageData.data); // Copy
        const frameBuf32 = new Uint32Array(frameData.buffer);
        
        const nextActiveParticles = [];
        let landedCount = 0;

        for (let p of activeParticles) {
            // Update position
            p.y += p.speed;
            p.speed += 0.2; // Gravity

            if (p.y >= p.targetY) {
                // Landed
                p.y = p.targetY;
                // Write to PERMANENT buffer (currentImageData)
                const idx = p.targetY * size + p.x;
                // Update the 'master' buffer
                buf32[idx] = (255 << 24) | (p.b << 16) | (p.g << 8) | p.r;
                // No longer active
            } else {
                // Still falling
                if (p.y >= 0) {
                    const py = Math.floor(p.y);
                    const idx = py * size + p.x;
                    // Write to FRAME buffer only
                    frameBuf32[idx] = (255 << 24) | (p.b << 16) | (p.g << 8) | p.r;
                }
                nextActiveParticles.push(p);
            }
        }
        
        activeParticles = nextActiveParticles;

        // Draw the frame
        const finalFrame = new ImageData(frameData, size, size);
        ctx.putImageData(finalFrame, 0, 0);

        // Throttle to ~30fps
        const frameTime = performance.now() - frameStart;
        const wait = Math.max(0, 33 - frameTime);
        await new Promise(r => setTimeout(r, wait));
    }

    recorder.stop();
    return recordingPromise;
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