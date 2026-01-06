import { processImages } from './processor.js';
import { uploadFile, saveCreation, getCreations, togglePublicStatus, subscribeToCreations } from './storage.js';

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
const galleryGrid = document.getElementById('gallery-grid');
const gallerySearch = document.getElementById('gallerySearch');
const navBtns = document.querySelectorAll('.nav-btn');

// State
let selectedFile = null;
let currentTab = 'create';
let currentUser = null;

// Init
async function init() {
    currentUser = await window.websim.getCurrentUser();
    if (!currentUser) {
        alert("Please sign in to use Pixel Alchemy");
        return;
    }

    // Init tabs
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Gallery Search
    gallerySearch.addEventListener('input', () => loadGallery(currentTab));
}

function switchTab(tab) {
    currentTab = tab;
    
    // Update Nav
    navBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update View
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if (tab === 'create') {
        document.getElementById('tab-create').classList.add('active');
    } else {
        document.getElementById('tab-gallery').classList.add('active');
        loadGallery(tab);
    }
}

async function loadGallery(mode) {
    galleryGrid.innerHTML = '<div class="loader"></div>';
    
    const records = await getCreations(mode);
    const filterText = gallerySearch.value.toLowerCase();
    
    const filtered = records.filter(item => 
        (item.prompt || '').toLowerCase().includes(filterText)
    );

    renderGallery(filtered, mode === 'mine');
}

function renderGallery(items, isMyGallery) {
    galleryGrid.innerHTML = '';
    
    if (items.length === 0) {
        galleryGrid.innerHTML = '<p style="text-align:center; color:var(--muted);">No creations found.</p>';
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        
        const date = new Date(item.timestamp).toLocaleDateString();
        const username = item.owner_username || 'Unknown Alchemist';
        
        // Public Toggle (Only for owner)
        let publicToggleHTML = '';
        if (isMyGallery) {
            publicToggleHTML = `
                <label class="public-toggle">
                    <input type="checkbox" class="public-check" data-id="${item.id}" ${item.is_public ? 'checked' : ''}>
                    Public
                </label>
            `;
        } else {
            publicToggleHTML = `
                <span style="font-size:0.8rem; color:var(--muted);">by ${username}</span>
            `;
        }

        // Assets
        const assets = [
            { url: item.source_url, label: 'Source' },
            { url: item.target_url, label: 'Target' },
            { url: item.algo1_url, label: 'S->T' },
            { url: item.algo2_url, label: 'T->S' }
        ];

        div.innerHTML = `
            <div class="gallery-header">
                <div>
                    <p class="gallery-prompt">"${item.prompt}"</p>
                    <div class="gallery-date">${date}</div>
                </div>
            </div>
            
            <div class="gallery-thumbs">
                ${assets.map(a => `<a href="${a.url}" target="_blank"><img src="${a.url}" title="${a.label}"></a>`).join('')}
                ${item.video_url ? `<a href="${item.video_url}" target="_blank"><video src="${item.video_url}" muted loop onmouseover="this.play()" onmouseout="this.pause()"></video></a>` : ''}
            </div>

            <div class="gallery-actions">
                ${publicToggleHTML}
                <div class="download-group">
                    <a href="${item.target_url}" download="pixel_alchemy_target.png" class="icon-btn" title="Download AI Result">⬇</a>
                    ${item.video_url ? `<a href="${item.video_url}" download="pixel_alchemy.webm" class="icon-btn" title="Download Video">▶</a>` : ''}
                </div>
            </div>
        `;

        galleryGrid.appendChild(div);
    });

    // Attach listeners for toggles
    if (isMyGallery) {
        document.querySelectorAll('.public-check').forEach(chk => {
            chk.addEventListener('change', async (e) => {
                const id = e.target.dataset.id;
                await togglePublicStatus(id, e.target.checked);
            });
        });
    }
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

        const { algo1Blob, algo2Blob, videoBlob } = await processImages(sourceObjUrl, targetObjUrl, ctx);
        
        // Clean up object URLs
        URL.revokeObjectURL(sourceObjUrl);
        URL.revokeObjectURL(targetObjUrl);

        updateStatus(80, "Uploading Algorithm Results & Video...");

        // 4. Upload Algo Results
        const algo1Url = await uploadFile(algo1Blob, "algo_source_to_target.png");
        const algo2Url = await uploadFile(algo2Blob, "algo_target_to_source.png");
        const videoUrl = await uploadFile(videoBlob, "diff_animation.webm");

        updateStatus(90, "Saving to Database...");

        // 5. Database Save
        const dataPayload = {
            prompt: promptInput.value,
            source_url: sourceUrl,
            target_url: targetUrl,
            algo1_url: algo1Url,
            algo2_url: algo2Url,
            video_url: videoUrl
        };

        await saveCreation(dataPayload);

        updateStatus(100, "Done!");
        
        // Render Result View immediately
        document.getElementById('res-original').src = sourceUrl;
        document.getElementById('res-target').src = targetUrl;
        document.getElementById('res-algo1').src = algo1Url;
        document.getElementById('res-algo2').src = algo2Url;
        document.getElementById('res-video').src = videoUrl;

        // Add download links for current results
        document.querySelectorAll('#results-section .dl-btn').forEach((btn, idx) => {
            // Mapping index to urls: 0=orig, 1=target, 2=algo1, 3=algo2, 4=video
            const urls = [sourceUrl, targetUrl, algo1Url, algo2Url, videoUrl];
            if(urls[idx]) btn.href = urls[idx];
        });

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

// renderHistory removed - replaced by unified renderGallery

init();