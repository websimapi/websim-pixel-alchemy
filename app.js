import { processImages } from './processor.js';
import { uploadFile, initOrUpdateUserRecord, subscribeToHistory } from './storage.js';

// Elements
const imageInput = document.getElementById('imageInput');
const preview = document.getElementById('preview');
const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('status-text');
const statusSection = document.getElementById('status-section');
const resultsSection = document.getElementById('results-section');
const inputSection = document.getElementById('input-section');
const historyList = document.getElementById('history-list');

// State
let selectedFile = null;

// Init
async function init() {
    const user = await window.websim.getCurrentUser();
    if (!user) {
        alert("Please sign in to use Pixel Alchemy");
        return;
    }

    // Subscribe to DB updates
    subscribeToHistory(renderHistory);
}

// Event Listeners
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (ev) => {
            preview.src = ev.target.result;
            preview.hidden = false;
            document.querySelector('.upload-placeholder').hidden = true;
            checkValidity();
        };
        reader.readAsDataURL(file);
    }
});

promptInput.addEventListener('input', checkValidity);

function checkValidity() {
    generateBtn.disabled = !(selectedFile && promptInput.value.trim().length > 0);
}

generateBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    try {
        // UI Transition
        inputSection.classList.add('hidden');
        resultsSection.classList.add('hidden');
        statusSection.classList.remove('hidden');
        updateStatus(10, "Uploading Source Image...");

        // 1. Upload Original
        // Start scanning effect on canvas
        const processCanvas = document.getElementById('processCanvas');
        const ctx = processCanvas.getContext('2d');
        const scanImg = new Image();
        scanImg.src = URL.createObjectURL(selectedFile);
        let scanAnimId;
        
        scanImg.onload = () => {
            // Simple scan animation loop
            let scanY = 0;
            const drawScan = () => {
                ctx.drawImage(scanImg, 0, 0, 512, 512);
                ctx.fillStyle = 'rgba(79, 70, 229, 0.3)'; // Primary color with opacity
                ctx.fillRect(0, scanY, 512, 20);
                scanY = (scanY + 5) % 512;
                scanAnimId = requestAnimationFrame(drawScan);
            };
            drawScan();
        };

        const sourceUrl = await uploadFile(selectedFile, "source.png");
        
        // Convert Blob to Base64 for ImageGen
        const sourceBase64 = await fileToBase64(selectedFile);

        updateStatus(30, "AI Generating Target Image (this takes ~10s)...");

        // 2. AI Gen
        const aiResult = await window.websim.imageGen({
            prompt: promptInput.value + " Keep composition similar, high quality, 4k.",
            image_inputs: [{ url: sourceBase64 }],
            aspect_ratio: "1:1", // keeping it simple for pixel sorting
            width: 512,
            height: 512
        });
        
        const targetUrlTemp = aiResult.url;

        // Need to fetch the AI result as a blob to upload it permanently and process it
        updateStatus(50, "Downloading AI Result...");
        const targetBlob = await fetch(targetUrlTemp).then(r => r.blob());
        const targetUrl = await uploadFile(targetBlob, "target_ai.png");

        // Stop scan animation
        if (scanAnimId) cancelAnimationFrame(scanAnimId);

        updateStatus(60, "Running Pixel Algorithms...");
        
        // 3. Process Algorithms with Visualization
        
        // Create local object URLs for fast access by the processor/canvas
        // Source is 'selectedFile' (File object)
        const sourceObjUrl = URL.createObjectURL(selectedFile);
        // Target is 'targetBlob' (Blob)
        const targetObjUrl = URL.createObjectURL(targetBlob);

        const { algo1Blob, algo2Blob } = await processImages(sourceObjUrl, targetObjUrl, ctx);
        
        // Clean up object URLs
        URL.revokeObjectURL(sourceObjUrl);
        URL.revokeObjectURL(targetObjUrl);

        updateStatus(80, "Uploading Algorithm Results...");

        // 4. Upload Algo Results
        const algo1Url = await uploadFile(algo1Blob, "algo_source_to_target.png");
        const algo2Url = await uploadFile(algo2Blob, "algo_target_to_source.png");

        updateStatus(90, "Saving to Database...");

        // 5. Database Save
        const dataPayload = {
            prompt: promptInput.value,
            source_url: sourceUrl,
            target_url: targetUrl,
            algo1_url: algo1Url,
            algo2_url: algo2Url
        };

        await initOrUpdateUserRecord(dataPayload);

        updateStatus(100, "Done!");
        
        // Render Result View immediately
        document.getElementById('res-original').src = sourceUrl;
        document.getElementById('res-target').src = targetUrl;
        document.getElementById('res-algo1').src = algo1Url;
        document.getElementById('res-algo2').src = algo2Url;

        statusSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
        inputSection.classList.remove('hidden');
        
        // Clear canvas for next time
        ctx.clearRect(0,0,512,512);

        // Reset inputs
        promptInput.value = "";
        preview.hidden = true;
        document.querySelector('.upload-placeholder').hidden = false;
        selectedFile = null;
        generateBtn.disabled = true;

    } catch (err) {
        console.error(err);
        statusText.innerText = "Error: " + err.message;
        setTimeout(() => {
            statusSection.classList.add('hidden');
            inputSection.classList.remove('hidden');
        }, 3000);
    }
});

function updateStatus(percent, text) {
    progressBar.value = percent;
    statusText.innerText = text;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function renderHistory(list) {
    historyList.innerHTML = '';
    // Reverse to show newest first
    const reversed = [...list].reverse();
    
    reversed.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        const date = new Date(item.timestamp).toLocaleString();
        
        div.innerHTML = `
            <span class="history-meta">${date} - "${item.prompt}"</span>
            <div class="history-thumbs">
                <a href="${item.source_url}" target="_blank"><img src="${item.source_url}" title="Source"></a>
                <a href="${item.target_url}" target="_blank"><img src="${item.target_url}" title="AI Target"></a>
                <a href="${item.algo1_url}" target="_blank"><img src="${item.algo1_url}" title="Source Px -> Target"></a>
                <a href="${item.algo2_url}" target="_blank"><img src="${item.algo2_url}" title="Target Px -> Source"></a>
            </div>
        `;
        historyList.appendChild(div);
    });
}

init();