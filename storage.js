const COLLECTION_NAME = 'user_pixel_records_v2';
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

export async function getUserRecord() {
    const user = await window.websim.getCurrentUser();
    // Filter specifically for the current user's record
    // Note: In websim, filter usually works on custom fields or built-in props. 
    // We assume 'username' is a field we populate or rely on created_by implicit filtering if strict ownership is on.
    // For safety, we will filter by a field we control.
    
    // Attempt to find the user's ONE row
    try {
        const records = await room.collection(COLLECTION_NAME).filter({
            owner_id: user.id
        }).getList();

        if (records && records.length > 0) {
            return records[0];
        }
    } catch (err) {
        console.warn("getUserRecord failed, likely collection empty or network", err);
    }
    return null;
}

export async function initOrUpdateUserRecord(dataObject) {
    console.log("Saving to DB...");
    const user = await window.websim.getCurrentUser();
    let record = null;
    
    try {
        record = await getUserRecord();
    } catch (e) {
        console.error("Error fetching record:", e);
    }

    // Prepare the structure to append
    const newEntry = {
        timestamp: new Date().toISOString(),
        ...dataObject
    };

    if (!record) {
        console.log("Creating new user record...");
        // Initialize: 10 columns of empty arrays/objects
        const payload = {
            owner_id: user.id,
            col_1: [newEntry], 
            col_2: [], col_3: [], col_4: [], col_5: [],
            col_6: [], col_7: [], col_8: [], col_9: [], col_10: []
        };
        await room.collection(COLLECTION_NAME).create(payload);
    } else {
        console.log("Updating existing record...", record.id);
        let currentList = record.col_1 || [];
        if (!Array.isArray(currentList)) currentList = [];
        currentList.push(newEntry);

        await room.collection(COLLECTION_NAME).update(record.id, {
            col_1: currentList
        });
    }
    console.log("DB Save complete.");
}

export function subscribeToHistory(callback) {
    const user = window.websim.getCurrentUser(); // Sync, might need await in init, but usually cached
    // Subscription returns all records, need to filter client side or rely on query
    return room.collection(COLLECTION_NAME).subscribe((records) => {
        // Find my record
        const myRecord = records.find(r => r.owner_id === window.websim.internalCurrentUser?.id || r.owner_id === user?.id); // fallback
        if (myRecord && myRecord.col_1) {
            callback(myRecord.col_1);
        } else {
            callback([]);
        }
    });
}