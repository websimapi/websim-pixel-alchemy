const COLLECTION_NAME = 'pixel_creations_v1';
const room = new WebsimSocket();

export async function uploadFile(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    try {
        const url = await window.websim.upload(file);
        return url;
    } catch (e) {
        console.error("Upload failed", e);
        throw e;
    }
}

export async function saveCreation(dataObject) {
    const user = await window.websim.getCurrentUser();
    
    const payload = {
        owner_id: user.id,
        owner_username: user.username,
        timestamp: new Date().toISOString(),
        is_public: false, // Default to private
        ...dataObject
    };

    await room.collection(COLLECTION_NAME).create(payload);
}

export async function getCreations(mode = 'mine') {
    const user = await window.websim.getCurrentUser();
    
    let filter = {};
    if (mode === 'mine') {
        filter = { owner_id: user.id };
    } else if (mode === 'public') {
        filter = { is_public: true };
    }

    try {
        const records = await room.collection(COLLECTION_NAME)
            .filter(filter)
            .getList();
        
        // Sort by timestamp desc manually if DB doesn't support sort in filter yet
        return records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (e) {
        console.error("Error fetching creations", e);
        return [];
    }
}

export async function togglePublicStatus(id, newStatus) {
    await room.collection(COLLECTION_NAME).update(id, {
        is_public: newStatus
    });
}

export function subscribeToCreations(callback) {
    // This subscribes to ALL changes, we might want to filter client side for better UX updates
    return room.collection(COLLECTION_NAME).subscribe((records) => {
        callback(records);
    });
}