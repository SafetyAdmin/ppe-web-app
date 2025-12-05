// ================================================================= //
// ==           PPE WEB APP (FIREBASE FINAL FIXED)                == //
// ==                        FILE: app.js                         == //
// ================================================================= //

// --- Global State ---
let ppeItemsCache = [];
let dispenseCart = [];
let dispenseHistoryCache = [];
let receiveHistoryCache = [];
let usersCache = [];
let departmentsCache = [];
let currentUser = null;
let confirmationDetails = {};
let signaturePad = null;
let walkinSignaturePad = null;
let lastReportData = null;

const COLLECTIONS = {
    INVENTORY: 'inventory',
    TRANSACTIONS: 'transactions',
    RECEIVE_LOGS: 'receive_logs',
    ADJUST_LOGS: 'adjust_logs',
    USERS: 'users',
    DEPARTMENTS: 'departments'
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initSignaturePad(); // Setup Signature Pad
    if (window.isFirebaseReady) {
        initApp();
    } else {
        document.addEventListener('firebase-ready', initApp);
    }
});

function initApp() {
    console.log("🚀 App Started (Final Fixed)");
    applySeasonalTheme();
    
    const { auth, onAuthStateChanged } = window;
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("User Logged In:", user.email);
            currentUser = user;
            
            try {
                // ✅ เพิ่ม try-catch ตรงนี้ เพื่อกันเหนียว
                await checkUserRole(user); 
            } catch (err) {
                console.error("Login Error:", err);
                alert("เกิดปัญหาระหว่างเข้าสู่ระบบ: " + err.message);
                hideLoading(); // ถ้าพัง ให้ปิด Loading ทันที
            }

        } else {
            console.log("No User");
            currentUser = null;
            showLoginInterface();
            hideLoading();
        }
    });

    setupEventListeners();
}

function initSignaturePad(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (canvas) {
        // Set canvas size to match parent width/height to prevent 0x0 issue
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext("2d").scale(ratio, ratio);

        // If global instance exists for this ID, clear it (optional, but safe)
        // Return new instance
        const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' });
        pad.off(); // Start disabled (locked)
        return pad;
    }
    return null;
}

// --- 1. CORE DATA LOGIC ---

async function refreshAllData() {
    showLoading();
    try {
        const { db, collection, getDocs, orderBy, query } = window;

        // 1. Inventory (ดึงของในคลัง)
        const invSnapshot = await getDocs(collection(db, COLLECTIONS.INVENTORY));
        ppeItemsCache = [];
        invSnapshot.forEach(doc => ppeItemsCache.push({ id: doc.id, ...doc.data() }));

        // 2. Transactions (ดึงประวัติการเบิกทั้งหมด)
        dispenseHistoryCache = [];
        try {
            // ดึงข้อมูลและเรียงตามเวลาล่าสุด
            const q = query(collection(db, COLLECTIONS.TRANSACTIONS), orderBy('timestamp', 'desc')); 
            const transSnapshot = await getDocs(q);
            
            transSnapshot.forEach(doc => {
                const data = doc.data();
                dispenseHistoryCache.push({
                    id: doc.id,
                    RequestCode: data.requestCode,
                    RequestDate: data.requestDate,
                    Timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
                    Department: data.department,
                    Requester: data.requesterName,
                    RequesterEmail: data.requesterEmail,
                    Items: data.itemsString,
                    RawItems: data.items,
                    Status: data.status,
                    ApprovedItems: data.approvedItemsString || '-',
                    ApprovalDate: data.approvalDate ? data.approvalDate.toDate() : null,
                    SignatureLink: data.signatureUrl,
                    AttachmentUrl: data.attachmentUrl
                });
            });
        } catch (err) {
            console.warn("User อาจไม่มีสิทธิ์อ่าน Transaction ทั้งหมด (ไม่เป็นไรถ้าเป็น User ทั่วไป)");
        }

        // 3. Receive Logs (ดึงประวัติรับของเข้า - เฉพาะ Admin ถึงจะดึงได้)
        receiveHistoryCache = [];
        if (currentUser && currentUser.role === 'Admin') {
            try {
                const receiveSnapshot = await getDocs(query(collection(db, COLLECTIONS.RECEIVE_LOGS), orderBy('timestamp', 'desc')));
                receiveSnapshot.forEach(doc => {
                    const data = doc.data();
                    receiveHistoryCache.push({
                        id: doc.id,
                        ReceiveCode: data.receiveCode,
                        Timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
                        Receiver: data.receiverName,
                        Items: data.itemsString
                    });
                });
            } catch (e) { console.warn("Skip Receive Logs"); }
        }

        // 4. Users & Departments (Admin Only)
        usersCache = [];
        departmentsCache = [];
        if (currentUser && currentUser.role === 'Admin') {
             try {
                const userSnapshot = await getDocs(collection(db, COLLECTIONS.USERS));
                userSnapshot.forEach(doc => usersCache.push(doc.data()));
                
                const deptSnapshot = await getDocs(collection(db, COLLECTIONS.DEPARTMENTS));
                deptSnapshot.forEach(doc => departmentsCache.push(doc.data().name));
            } catch (e) { console.warn("Skip Users/Dept fetch"); }
        } else {
             // ถ้าเป็น User ธรรมดา ดึงแค่แผนกก็พอ (เพื่อใส่ใน Dropdown)
             try {
                const deptSnapshot = await getDocs(collection(db, COLLECTIONS.DEPARTMENTS));
                deptSnapshot.forEach(doc => departmentsCache.push(doc.data().name));
             } catch(e) {}
        }


        // --- 🎨 ส่วน Render UI (จุดที่แก้ไข: เติมให้ครบทุกหน้า) ---
        
        // 1. หน้าคลังสินค้า
        filterAndRenderInventory(); 

        // 2. หน้าประวัติการเบิก (User/Admin)
        renderDispenseHistory(dispenseHistoryCache);

        // 3. หน้าอนุมัติ (เฉพาะ Admin)
        const pendingReqs = dispenseHistoryCache.filter(r => r.Status === 'Pending');
        renderPendingRequests(pendingReqs);

        // 4. หน้าตัดยอด/รับของ (เฉพาะ Admin)
        const pickupReqs = dispenseHistoryCache.filter(r => r.Status === 'Approved');
        renderPickupList(pickupReqs);

        // 5. หน้ารับของเข้า (เฉพาะ Admin)
        renderReceiveHistory(receiveHistoryCache);

        // 6. หน้าตั้งค่า (User/Dept List)
        renderUserList(usersCache);
        renderDepartmentList(departmentsCache);
        
        // 7. เติม Dropdown แผนก
        populateHistoryDepartmentFilter(departmentsCache);
        populateAdjustmentDropdown();
        populateReportItemDropdown();

        console.log("✅ Data Refreshed & Rendered Successfully");

    } catch (error) {
        console.error("Critical Refresh Error:", error);
        alert("เกิดข้อผิดพลาดในการโหลดข้อมูล: " + error.message);
    } finally {
        hideLoading();
    }
}

async function checkUserRole(user) {
    const { db, doc, getDoc } = window;
    const userRef = doc(db, COLLECTIONS.USERS, user.email);
    
    try {
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
            // ✅ กรณีที่ 1: มีข้อมูล User
            const userData = docSnap.data();
            currentUser.role = userData.role || 'User';
            
            // เช็คว่ามีชื่อตั้งเองหรือยัง
            if (userData.name && userData.name.trim() !== "") {
                currentUser.displayName = userData.name;
                showAppInterface(); 
                refreshAllData(); // ฟังก์ชันนี้มี hideLoading() ของมันเอง
            } else {
                showNameInputModal(); // ในนี้มี hideLoading() แล้ว
            }
            
            // อัปเดตข้อมูลรูป (ถ้ามี)
            if (user.photoURL && user.photoURL !== userData.photoURL) {
                window.updateDoc(userRef, { photoURL: user.photoURL }, { merge: true });
            }

        } else {
            // ⛔ กรณีที่ 2: ไม่มี User ในระบบ (ครั้งแรก)
            
            // 🔥 แก้ไข: แทนที่จะเตะออกเลย ให้เด้งไปหน้าตั้งชื่อ เพื่อสร้าง User ใหม่ลง DB
            console.log("New User detected, forcing name setup.");
            showNameInputModal(); 
        }

    } catch (e) {
        console.error("Check Role Error:", e);
        alert("เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์: " + e.message);
        hideLoading(); // ✅ สำคัญ! ต้องสั่งปิดตรงนี้ด้วยถ้า Error
    }
}

function updateUIByRole() {
    const isAdmin = currentUser.role === 'Admin';
    document.querySelectorAll('.permission-hidden').forEach(el => {
        if (isAdmin) el.classList.remove('permission-hidden');
        else el.classList.add('permission-hidden');
    });
}

// --- 2. UI MANAGEMENT (นี่คือส่วนที่หายไป) ---

function showLoginInterface() {
    document.getElementById('app-container').classList.add('hidden');
    let loginDiv = document.getElementById('login-screen');
    if (!loginDiv) {
        loginDiv = document.createElement('div');
        loginDiv.id = 'login-screen';
        loginDiv.className = "fixed inset-0 flex items-center justify-center bg-gray-100 z-50";
        loginDiv.innerHTML = `
            <div class="bg-white p-8 rounded-xl shadow-2xl text-center max-w-md w-full">
                <img src="https://img2.pic.in.th/pic/1611a66841c612aa7d98095cab7da37e.png" class="w-24 h-24 mx-auto mb-4 rounded-lg shadow">
                <h1 class="text-2xl font-bold text-gray-800 mb-2">ระบบเบิกจ่าย PPE</h1>
                <p class="text-gray-500 mb-8">กรุณาล็อกอินเพื่อเข้าใช้งาน</p>
                <button onclick="window.login()" class="w-full bg-white border border-gray-300 text-gray-700 font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-3 hover:bg-gray-50 transition shadow-sm">
                    <i class="fab fa-google text-red-500 text-xl"></i> Sign in with Google
                </button>
            </div>
        `;
        document.body.appendChild(loginDiv);
    }
    loginDiv.classList.remove('hidden');
}

function showAppInterface() {
    const loginDiv = document.getElementById('login-screen');
    if (loginDiv) loginDiv.classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');

    document.getElementById('user-name-display').innerText = currentUser.displayName;
    document.getElementById('user-role-display').innerText = currentUser.role;
    
    if (!document.getElementById('logout-btn')) {
        const headerDiv = document.getElementById('user-role-display').parentElement;
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logout-btn';
        logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
        logoutBtn.className = "ml-2 text-red-500 hover:text-red-700 text-lg";
        logoutBtn.onclick = window.logout;
        headerDiv.appendChild(logoutBtn);
    }
}

// --- 3. ACTION FUNCTIONS ---

async function saveInventoryItem(itemData) {
    try {
        const { db, collection, addDoc, updateDoc, doc } = window;
        
        // ✅ FIX: เช็ค ID ให้แม่นยำขึ้น
        const docId = itemData.id; 

        if (docId && docId !== "" && docId !== "undefined") {
            // UPDATE
            console.log("Updating Item:", docId);
            const itemRef = doc(db, COLLECTIONS.INVENTORY, docId);
            const { id, ...data } = itemData; // เอา ID ออกก่อนบันทึก
            await updateDoc(itemRef, data);
            alert("✅ แก้ไขข้อมูลสำเร็จ");
        } else {
            // CREATE
            console.log("Creating New Item");
            const { id, ...newItemData } = itemData; // เอา ID ว่างๆ ออก
            await addDoc(collection(db, COLLECTIONS.INVENTORY), newItemData);
            alert("✅ เพิ่มอุปกรณ์สำเร็จ");
        }
        closeModal('item-modal');
        refreshAllData();
    } catch (e) {
        alert("Error: " + e.message);
    }
}

async function deleteInventoryItem(itemId) {
    if (!itemId) return;
    showLoading();
    try {
        const { db, doc, deleteDoc } = window;
        await deleteDoc(doc(db, COLLECTIONS.INVENTORY, itemId));
        alert("✅ ลบอุปกรณ์สำเร็จ");
        closeModal('confirmation-modal');
        refreshAllData();
    } catch (e) {
        alert("Error: " + e.message);
        hideLoading();
    }
}

async function submitDispenseRequest(formData) {
    if (!currentUser) return;
    showLoading();
    try {
        const { db, collection, addDoc } = window;
        const itemsString = formData.items.map(i => `${i.itemName} (x${i.quantity})`).join(', ');
        
        await addDoc(collection(db, COLLECTIONS.TRANSACTIONS), {
            requestCode: document.getElementById('dispense-code').value || `REQ-${Date.now()}`,
            requestDate: formData.requestDate,
            department: formData.department,
            requesterName: formData.requesterName,
            requesterEmail: currentUser.email,
            items: formData.items, 
            itemsString: itemsString, 
            signatureUrl: formData.signatureImage, 
            
            // ✅ เพิ่มบรรทัดนี้: บันทึกรูปใบเบิก (ถ้าไม่มีจะเป็นสตริงว่าง)
            attachmentUrl: formData.attachmentImage || '', 
            status: 'Pending',
            timestamp: new Date()
        });

        // 🔥 [เพิ่มตรงนี้] สั่งแจ้งเตือนไลน์เมื่อมีการเบิก
        let msg = `📢 มีคำขอเบิกใหม่!\nคุณ: ${formData.requesterName}\nแผนก: ${formData.department}\nรายการ: ${itemsString}`;
        
        await sendLineNotification(msg); // <-- ไม่ต้องใส่อะไรเพิ่ม มันจะวิ่งไปหา ID ส่วนตัว
        // ---------------------------------------------

        alert("✅ ส่งคำขอเบิกสำเร็จ!"); // (บรรทัดเดิม)
        
        // เคลียร์ค่าไฟล์ Input ด้วย
        document.getElementById('dispense-attachment').value = ""; 
        
        closeModal('dispense-modal');
        closeModal('cart-modal');
        dispenseCart = [];
        updateCartUI();
        refreshAllData();
    } catch (e) { alert("Error: " + e.message); hideLoading(); }
}

// --- ฟังก์ชันเสริม: ส่งแจ้งเตือน LINE ---
async function sendLineNotification(messageText, targetUid) {
    // ⚠️ ถ้าไม่ได้ระบุผู้รับมา จะใช้ ID ส่วนตัวเป็นค่า Default
    const defaultId = "U64847d26d65aa2158092a0de6b07ba56"; // <-- ใส่ ID ส่วนตัวของคุณที่นี่
    
    const finalTarget = targetUid || defaultId; // เลือก ID ที่จะส่ง

    console.log("🚀 กำลังส่งไลน์ไปหา:", finalTarget);

    try {
        const response = await fetch('/api/line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: finalTarget, 
                messages: [
                    { type: 'text', text: messageText }
                ]
            })
        });

        if (!response.ok) {
            console.error("❌ ส่งไม่ผ่าน:", await response.text());
        } else {
            console.log("✅ ส่งไลน์สำเร็จ");
        }
    } catch (error) {
        console.error("❌ LINE Error:", error);
    }
}


// --- แก้ไขฟังก์ชัน setUserRole ---
async function setUserRole(email, role, name, photoBase64) { // <--- รับ photoBase64 เพิ่ม
    if (!email) return alert("กรุณากรอกอีเมล");
    showLoading();
    try {
        const { db, doc, setDoc } = window;
        
        // ข้อมูลที่จะบันทึก
        let userData = { 
            email: email,
            role: role,
            name: name || email.split('@')[0],
            updatedAt: new Date()
        };

        // ถ้ามีรูปภาพส่งมา ให้บันทึกทับของเดิม / ถ้าไม่มีก็ปล่อยไว้เหมือนเดิม
        if (photoBase64) {
            userData.photoURL = photoBase64;
        }

        await setDoc(doc(db, COLLECTIONS.USERS, email), userData, { merge: true });

        alert(`✅ บันทึกผู้ใช้สำเร็จ`);
        document.getElementById('add-user-form').reset();
        // ล้างค่า file input ด้วย (เพราะ reset() บางทีไม่เคลียร์)
        document.getElementById('new-user-image').value = ""; 
        refreshAllData(); 
    } catch (e) { 
        console.error(e);
        alert("Error: " + e.message); 
    } finally {
        hideLoading();
    }
}

async function addDepartment(name) {
    showLoading();
    try {
        const { db, collection, addDoc } = window;
        await addDoc(collection(db, COLLECTIONS.DEPARTMENTS), { name: name });
        alert("✅ เพิ่มแผนกสำเร็จ");
        document.getElementById('department-form').reset();
        refreshAllData();
    } catch (e) { alert("Error: " + e.message); hideLoading(); }
}

async function deleteDepartment(name) {
    showLoading();
    try {
        const { db, collection, getDocs, query, where, deleteDoc } = window;
        const q = query(collection(db, COLLECTIONS.DEPARTMENTS), where("name", "==", name));
        const snapshot = await getDocs(q);
        snapshot.forEach(async (doc) => { await deleteDoc(doc.ref); });
        alert("✅ ลบแผนกสำเร็จ");
        closeModal('confirmation-modal');
        refreshAllData();
    } catch (e) { alert("Error: " + e.message); hideLoading(); }
}

async function approveRequest(requestCode, approvedItems) {
    showLoading();
    try {
        const { db, doc, runTransaction } = window;
        const request = dispenseHistoryCache.find(r => r.RequestCode === requestCode);
        if(!request) throw new Error("Request not found");
        const requestRef = doc(db, COLLECTIONS.TRANSACTIONS, request.id);
        await runTransaction(db, async (transaction) => {
            for (const item of approvedItems) {
                const invItem = ppeItemsCache.find(i => i.code === item.itemCode || i.name === item.itemName); 
                if (invItem) {
                    const invRef = doc(db, COLLECTIONS.INVENTORY, invItem.id);
                    const invDoc = await transaction.get(invRef);
                    if(invDoc.exists()) {
                        const newQty = (invDoc.data().totalQuantity || 0) - item.quantity;
                        transaction.update(invRef, { totalQuantity: Math.max(0, newQty) });
                    }
                }
            }
            const approvedString = approvedItems.map(i => `${i.itemName} (x${i.quantity})`).join(', ');
            transaction.update(requestRef, {
                status: 'Approved',
                approvedItemsString: approvedString,
                approver: currentUser.email,
                approvalDate: new Date()
            });
        });

        // 🔥 [เพิ่มตรงนี้] สั่งแจ้งเตือนไลน์เมื่ออนุมัติ
        let msg = `✅ อนุมัติแล้ว!\nรหัส: ${requestCode}\nรายการ: ${approvedString}`;
        await sendLineNotification(msg);
        // ---------------------------------------------

        alert("✅ อนุมัติสำเร็จ"); // (บรรทัดเดิม)
        closeModal('approval-modal');
        refreshAllData();
    } catch (e) { alert("Error: " + e.message); hideLoading(); }
}

async function confirmPickup(requestCode) {
    showLoading();
    try {
        const { db, doc, updateDoc, runTransaction } = window;
        
        // 1. หาเอกสารใบเบิกจาก Cache
        const request = dispenseHistoryCache.find(r => r.RequestCode === requestCode);
        if(!request) throw new Error("ไม่พบข้อมูลใบเบิกนี้ในระบบ");

        const requestRef = doc(db, COLLECTIONS.TRANSACTIONS, request.id);

        // 2. ใช้ Transaction เพื่อความชัวร์ (ตัดยอดจริง)
        // หมายเหตุ: ปกติเราตัดสต็อกตอน Approve ไปแล้ว 
        // แต่ถ้า Workflow ของคุณคือ "ตัดตอนรับของ" ให้เปิดใช้โค้ดในคอมเมนต์ด้านล่าง
        
        /* // -- ถ้าต้องการตัดสต็อก "ตอนรับของ" ให้ใช้ส่วนนี้ --
        await runTransaction(db, async (transaction) => {
            // วนลูปตัดสต็อกสินค้าแต่ละตัว
            for (const item of request.RawItems) {
                const invItem = ppeItemsCache.find(i => i.code === item.itemCode);
                if (invItem) {
                    const invRef = doc(db, COLLECTIONS.INVENTORY, invItem.id);
                    const invDoc = await transaction.get(invRef);
                    if (invDoc.exists()) {
                        const newQty = (invDoc.data().totalQuantity || 0) - item.quantity;
                        transaction.update(invRef, { totalQuantity: Math.max(0, newQty) });
                    }
                }
            }
            // อัปเดตสถานะใบเบิก
            transaction.update(requestRef, { status: 'Completed' });
        });
        */

        // -- ถ้าตัดสต็อกไปแล้วตอน Approve (ใช้แบบนี้) --
        await updateDoc(requestRef, { status: 'Completed' });

        alert("✅ ยืนยันการรับของเรียบร้อย (Completed)");
        closeModal('confirmation-modal');
        refreshAllData();

    } catch (e) {
        console.error(e);
        alert("เกิดข้อผิดพลาด: " + e.message);
    } finally {
        hideLoading();
    }
}

async function processConfirmPickup(requestCode) {
    showLoading();
    try {
        const { db, doc, updateDoc } = window;
        // 1. หาข้อมูลจาก Cache
        const request = dispenseHistoryCache.find(r => r.RequestCode === requestCode);
        
        if (request) {
            // 2. อัปเดตสถานะใน Firebase เป็น Completed
            await updateDoc(doc(db, COLLECTIONS.TRANSACTIONS, request.id), { status: 'Completed' });

            // 🔥 [เพิ่มใหม่] สั่งแจ้งเตือนไลน์เมื่อรับของเสร็จสิ้น
            let msg = `📦 รับของเรียบร้อยแล้ว (Completed)\nรหัส: ${requestCode}\nผู้รับ: ${request.Requester}\nรายการ: ${request.ApprovedItems || request.Items}`;
            
            await sendLineNotification(msg); 
            // ---------------------------------------------

            alert("✅ ตัดยอดสำเร็จ");
            closeModal('confirmation-modal');
            refreshAllData();
        } else {
            alert("ไม่พบรายการนี้ในระบบ");
            hideLoading();
            closeModal('confirmation-modal');
        }
    } catch (e) { 
        alert("Error: " + e.message); 
        hideLoading(); 
    }
}

async function rejectRequest(requestCode, reason) {
    showLoading();
    try {
        const { db, doc, updateDoc } = window;
        const request = dispenseHistoryCache.find(r => r.RequestCode === requestCode);
        if(request) {
            await updateDoc(doc(db, COLLECTIONS.TRANSACTIONS, request.id), { status: 'Rejected', rejectionReason: reason });
            alert("✅ ปฏิเสธคำขอสำเร็จ");
            closeModal('rejection-modal');
            refreshAllData();
        }
    } catch (e) { alert("Error: " + e.message); hideLoading(); }
}

async function processReceiveForm(formData) {
    showLoading();
    try {
        const { db, collection, doc, runTransaction } = window;

        // 1. สร้างรายการของเป็นข้อความเตรียมไว้ก่อน (ใช้ทั้งบันทึก DB และส่งไลน์)
        const itemsString = formData.items.map(i => `${i.itemName} (x${i.quantity})`).join(', ');

        await runTransaction(db, async (transaction) => {
            for (const item of formData.items) {
                const invItem = ppeItemsCache.find(i => i.code === item.itemCode);
                if (invItem) {
                    const invRef = doc(db, COLLECTIONS.INVENTORY, invItem.id);
                    const invDoc = await transaction.get(invRef);
                    const newQty = (invDoc.data().totalQuantity || 0) + item.quantity;
                    transaction.update(invRef, { totalQuantity: newQty });
                }
            }
            
            const newLogRef = doc(collection(db, COLLECTIONS.RECEIVE_LOGS));
            transaction.set(newLogRef, {
                receiveCode: formData.receiveCode,
                receiveDate: formData.receiveDate,
                receiverName: formData.receiverName,
                itemsString: itemsString, // ใช้ตัวแปรที่สร้างไว้ด้านบน
                timestamp: new Date()
            });
        });

        // 🔥 [เพิ่มส่วนนี้] แจ้งเตือน LINE เมื่อรับของเข้า (Stock In)
        // หมายเหตุ: ถ้าต้องการส่งเข้า "กลุ่ม" ต้องเอา Group ID มาใส่ในช่องพารามิเตอร์ที่ 2
        // เช่น await sendLineNotification(msg, 'Cxxxxxxxxxxxx...'); 
        // ถ้าไม่ใส่ จะส่งไปหา ID ส่วนตัวที่คุณตั้งไว้ในฟังก์ชัน sendLineNotification
        let msg = `🚚 รับของเข้าคลัง (Stock In)\nรหัส: ${formData.receiveCode}\nผู้รับ: ${formData.receiverName}\nรายการ: ${itemsString}`;
        
        await sendLineNotification(msg); 
        // ----------------------------------------------------

        alert("✅ บันทึกรับของสำเร็จ");
        closeModal('receive-modal');
        refreshAllData();
    } catch (e) { 
        alert("Error: " + e.message); 
        hideLoading(); 
    }
}

async function processWalkInDispense(walkInData) {
    showLoading();
    try {
        const { db, collection, doc, runTransaction } = window;
        const itemsString = walkInData.items.map(i => `${i.itemName} (x${i.quantity})`).join(', ');
        await runTransaction(db, async (transaction) => {
            for (const item of walkInData.items) {
                const invItem = ppeItemsCache.find(i => i.code === item.itemCode);
                if (invItem) {
                    const invRef = doc(db, COLLECTIONS.INVENTORY, invItem.id);
                    const invDoc = await transaction.get(invRef);
                    const currentQty = invDoc.data().totalQuantity || 0;
                    if(item.quantity > currentQty) throw new Error(`ของไม่พอ: ${item.itemName}`);
                    transaction.update(invRef, { totalQuantity: currentQty - item.quantity });
                }
            }
            const newTransRef = doc(collection(db, COLLECTIONS.TRANSACTIONS));
            transaction.set(newTransRef, {
                requestCode: `WALKIN-${Date.now()}`,
                requestDate: new Date().toISOString().split('T')[0],
                department: walkInData.department,
                requesterName: walkInData.requesterName,
                requesterEmail: 'Admin Walk-in',
                itemsString: itemsString,
                status: 'Completed',
                signatureUrl: walkInData.signatureImageBase64,
                timestamp: new Date()
            });
        });
        alert("✅ เบิกด่วนสำเร็จ");
        closeModal('confirmation-modal');
        document.getElementById('walkin-form').reset();
        document.getElementById('walkin-item-list').innerHTML = '';
        refreshAllData();
    } catch (e) { alert("Error: " + e.message); hideLoading(); }
}

async function processStockAdjustment(adjData) {
    showLoading();
    try {
        const { db, collection, doc, runTransaction, addDoc } = window;
        if (adjData.itemCode) {
            const item = ppeItemsCache.find(i => i.code === adjData.itemCode);
            if(!item) throw new Error("Item not found");
            await runTransaction(db, async (transaction) => {
                const itemRef = doc(db, COLLECTIONS.INVENTORY, item.id);
                const itemDoc = await transaction.get(itemRef);
                const currentQty = itemDoc.data().totalQuantity || 0;
                let newQty = 0;
                if(adjData.mode === 'set') newQty = adjData.quantity;
                else newQty = currentQty + adjData.quantity;
                if(newQty < 0) throw new Error("สต็อกติดลบไม่ได้");
                transaction.update(itemRef, { totalQuantity: newQty });
            });
            await addDoc(collection(db, COLLECTIONS.ADJUST_LOGS), {
                itemCode: adjData.itemCode,
                reason: adjData.reason,
                admin: currentUser.email,
                timestamp: new Date()
            });
            alert("✅ ปรับสต็อกสำเร็จ");
        } else if (adjData.adjustments) {
            await runTransaction(db, async (transaction) => {
                for (const adj of adjData.adjustments) {
                    const item = ppeItemsCache.find(i => i.code === adj.itemCode);
                    if(item) {
                        const itemRef = doc(db, COLLECTIONS.INVENTORY, item.id);
                        transaction.update(itemRef, { totalQuantity: adj.newQuantity });
                    }
                }
            });
             await addDoc(collection(db, COLLECTIONS.ADJUST_LOGS), {
                type: 'Stock Take',
                count: adjData.adjustments.length,
                admin: currentUser.email,
                timestamp: new Date()
            });
            alert(`✅ ตรวจนับสำเร็จ ${adjData.adjustments.length} รายการ`);
        }
        closeModal('confirmation-modal');
        document.getElementById('adjustment-form').reset();
        refreshAllData();
    } catch (e) { alert("Error: " + e.message); hideLoading(); }
}

function generateReport(criteria) {
    const container = document.getElementById('report-results');
    if (!container) return;
    
    container.innerHTML = '<div class="text-center text-gray-500 p-4">กำลังประมวลผล...</div>';

    // 1. กรองข้อมูล
    let filteredData = dispenseHistoryCache.filter(t => 
        t.Status === 'Approved' || t.Status === 'Completed'
    );

    const targetMonth = parseInt(criteria.month);
    const targetYear = parseInt(criteria.year);
    const monthNames = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

    filteredData = filteredData.filter(t => {
        const d = t.Timestamp;
        if (criteria.type === 'monthly') {
            return (d.getMonth() + 1) === targetMonth && d.getFullYear() === targetYear;
        } else {
            return d.getFullYear() === targetYear;
        }
    });

    // 2. รวบรวมข้อมูล
    let reportStats = {}; 
    let totalRequests = filteredData.length;
    let totalItemsCount = 0;

    filteredData.forEach(trans => {
        if (trans.RawItems && Array.isArray(trans.RawItems)) {
            trans.RawItems.forEach(item => {
                if (criteria.itemCode !== 'all' && item.itemCode !== criteria.itemCode) return;
                const name = item.itemName;
                if (!reportStats[name]) reportStats[name] = 0;
                reportStats[name] += parseInt(item.quantity || 0);
                totalItemsCount += parseInt(item.quantity || 0);
            });
        }
    });

    // 3. เรียงลำดับข้อมูล
    const sortedItems = Object.entries(reportStats).sort(([,a], [,b]) => b - a);

    // 4. บันทึกข้อมูลลงตัวแปร Global (เพื่อส่งไปพิมพ์)
    lastReportData = {
        title: criteria.type === 'monthly' 
            ? `รายงานการเบิกจ่าย ประจำเดือน ${monthNames[targetMonth-1]} ${targetYear}`
            : `รายงานการเบิกจ่าย ประจำปี ${targetYear}`,
        totalRequests,
        totalItemsCount,
        items: sortedItems,
        printDate: new Date().toLocaleString('th-TH')
    };

    // 5. แสดงผลบนหน้าจอ (UI)
    if (sortedItems.length === 0) {
        container.innerHTML = `<div class="bg-yellow-50 text-yellow-700 p-4 rounded text-center border border-yellow-200">ไม่พบข้อมูล</div>`;
        return;
    }

    let tableHtml = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div class="bg-blue-50 p-4 rounded border border-blue-100">
                <h4 class="text-sm font-bold text-blue-800">จำนวนคำขอทั้งหมด</h4>
                <p class="text-2xl font-bold text-blue-600">${totalRequests} <span class="text-sm font-normal">รายการ</span></p>
            </div>
            <div class="bg-green-50 p-4 rounded border border-green-100">
                <h4 class="text-sm font-bold text-green-800">ยอดเบิกรวม (ชิ้น)</h4>
                <p class="text-2xl font-bold text-green-600">${totalItemsCount} <span class="text-sm font-normal">ชิ้น</span></p>
            </div>
        </div>
        <div class="overflow-hidden border rounded-lg shadow-sm bg-white mb-4">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-100 text-gray-700 font-bold">
                    <tr><th class="p-3">ลำดับ</th><th class="p-3">ชื่ออุปกรณ์</th><th class="p-3 text-right">จำนวน</th></tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${sortedItems.map(([name, qty], index) => `
                        <tr class="hover:bg-gray-50">
                            <td class="p-3 text-gray-500">${index + 1}</td>
                            <td class="p-3 font-medium text-gray-800">${name}</td>
                            <td class="p-3 text-right font-bold text-purple-600">${qty}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div class="text-right">
            <button onclick="printReportWindow()" class="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-900 shadow transition flex items-center gap-2 ml-auto">
                <i class="fas fa-print"></i> พิมพ์รายงาน (PDF)
            </button>
        </div>
    `;
    container.innerHTML = tableHtml;
}

// --- ฟังก์ชันเปิดหน้าต่างพิมพ์ใหม่ (Professional Table) ---
function printReportWindow() {
    if (!lastReportData) return alert("กรุณากดดูรายงานก่อนพิมพ์");

    // เปิดหน้าต่างใหม่
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    
    // สร้าง HTML สำหรับหน้าพิมพ์โดยเฉพาะ (CSS เน้นงานเอกสาร)
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <title>พิมพ์รายงาน PPE</title>
            <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Sarabun', sans-serif; padding: 40px; color: #000; }
                .header { text-align: center; margin-bottom: 30px; }
                .header h1 { margin: 0; font-size: 24px; font-weight: bold; }
                .header p { margin: 5px 0 0; color: #555; font-size: 14px; }
                
                .summary-box { display: flex; justify-content: space-between; margin-bottom: 20px; border: 1px solid #000; padding: 15px; }
                .summary-item { text-align: center; width: 48%; }
                .summary-item span { display: block; font-size: 12px; color: #666; }
                .summary-item strong { font-size: 18px; }

                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                th, td { border: 1px solid #000; padding: 10px; text-align: left; font-size: 14px; }
                th { background-color: #f0f0f0; text-align: center; font-weight: bold; }
                td.num { text-align: right; }
                td.center { text-align: center; }

                .footer { margin-top: 50px; display: flex; justify-content: space-between; page-break-inside: avoid; }
                .sign-box { text-align: center; width: 200px; }
                .sign-line { border-bottom: 1px dotted #000; height: 30px; margin-bottom: 10px; margin-top: 30px;}
                
                .print-info { font-size: 10px; color: #999; text-align: right; margin-top: 20px; border-top: 1px solid #eee; pt: 5px; }

                @media print {
                    @page { margin: 1cm; size: A4; }
                    body { padding: 0; }
                    button { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${lastReportData.title}</h1>
                <p>ระบบบริหารจัดการอุปกรณ์ป้องกันภัยส่วนบุคคล (PPE)</p>
            </div>

            <div class="summary-box">
                <div class="summary-item">
                    <span>จำนวนคำขอเบิกทั้งหมด</span>
                    <strong>${lastReportData.totalRequests} รายการ</strong>
                </div>
                <div class="summary-item" style="border-left: 1px solid #ddd;">
                    <span>รวมจำนวนชิ้นที่จ่ายออก</span>
                    <strong>${lastReportData.totalItemsCount} ชิ้น</strong>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 10%;">ลำดับ</th>
                        <th style="width: 70%;">รายการอุปกรณ์</th>
                        <th style="width: 20%;">จำนวนที่เบิก (ชิ้น)</th>
                    </tr>
                </thead>
                <tbody>
                    ${lastReportData.items.map(([name, qty], index) => `
                        <tr>
                            <td class="center">${index + 1}</td>
                            <td>${name}</td>
                            <td class="num">${qty}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="footer">
                <div class="sign-box">
                    <div>ผู้จัดทำรายงาน</div>
                    <div class="sign-line"></div>
                    <div>(..........................................)</div>
                    <div style="margin-top:5px;">วันที่ ...../...../..........</div>
                </div>
                <div class="sign-box">
                    <div>ผู้อนุมัติ/ตรวจสอบ</div>
                    <div class="sign-line"></div>
                    <div>(..........................................)</div>
                    <div style="margin-top:5px;">วันที่ ...../...../..........</div>
                </div>
            </div>

            <div class="print-info">
                พิมพ์เมื่อ: ${lastReportData.printDate}
            </div>

            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
}

// --- 4. RENDER FUNCTIONS ---

function filterAndRenderInventory() {
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';
    const categorySelect = document.getElementById('category-filter');
    const selectedCategory = categorySelect?.value || 'all';

    if (categorySelect && categorySelect.options.length <= 1) {
        const categories = [...new Set(ppeItemsCache.map(i => i.category))].filter(Boolean).sort();
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            categorySelect.appendChild(opt);
        });
    }

    let filtered = ppeItemsCache.filter(item => {
        const matchesSearch = (item.name || '').toLowerCase().includes(searchTerm) || 
                              (item.code || '').toLowerCase().includes(searchTerm);
        const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    renderInventoryCards(filtered);
}

function renderInventoryCards(items) {
    const container = document.getElementById('inventory-list');
    if(!container) return;
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">ไม่พบอุปกรณ์</p>';
        return;
    }

    container.innerHTML = items.map(item => {
        // --- ส่วนคำนวณยอด (Logic เดิม) ---
        let pendingQty = 0;
        try {
            if (typeof dispenseHistoryCache !== 'undefined' && Array.isArray(dispenseHistoryCache)) {
                pendingQty = dispenseHistoryCache
                    .filter(req => req.Status === 'Pending')
                    .reduce((sum, req) => {
                        const match = req.RawItems.find(r => r.itemCode === item.code || r.itemName === item.name);
                        return sum + (match ? parseInt(match.quantity || 0) : 0);
                    }, 0);
            }
        } catch (e) { console.warn("Calculation skipped"); }

        const totalQty = parseInt(item.totalQuantity || 0);
        const availableQty = Math.max(0, totalQty - pendingQty);
        const itemId = item.id; 

        // --- เริ่มสร้าง HTML การ์ดใหม่ ---
        return `
        <div class="relative bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 flex flex-col overflow-hidden group">
            
            <div class="absolute top-3 right-3 z-10 flex gap-2 permission-hidden opacity-0 group-hover:opacity-100 transition-opacity" data-permission="can_manage_inventory">
                <button onclick="window.editItem('${itemId}')" class="w-8 h-8 rounded-full bg-yellow-400 text-white flex items-center justify-center shadow hover:bg-yellow-500 transition">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="window.deleteItem('${itemId}')" class="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center shadow hover:bg-red-600 transition">
                    <i class="fas fa-trash"></i>
                </button>
            </div>

            <div class="h-48 w-full bg-gray-50 flex items-center justify-center p-4">
                <img src="${item.imageUrl || 'https://placehold.co/600x400/e2e8f0/cbd5e0?text=PPE'}" 
                     class="h-full w-full object-contain drop-shadow-sm transition-transform duration-500 group-hover:scale-110">
            </div>

            <div class="p-5 flex flex-col flex-grow">
                <div class="flex justify-between items-start mb-1">
                    <h3 class="text-lg font-bold text-gray-800 line-clamp-1">${item.name}</h3>
                    <span class="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full font-mono">${item.code}</span>
                </div>
                
                <div class="mt-auto pt-2">
                     <div class="mb-4">
                         <p class="text-gray-600 text-sm">
                            พร้อมใช้: <span class="font-bold text-2xl text-purple-600">${availableQty}</span> ${item.unit}
                         </p>
                         <p class="text-xs text-gray-400 mt-1">
                            รออนุมัติ: ${pendingQty} / ทั้งหมด: ${totalQty}
                         </p>
                     </div>

                    <div class="flex flex-col gap-3">
                        
                        <div class="flex items-center justify-center gap-4 bg-gray-50 rounded-lg p-1">
                            <button onclick="window.adjustQty('${itemId}', -1)" class="w-8 h-8 rounded-full bg-white shadow-sm text-gray-600 hover:text-red-500 hover:shadow transition flex items-center justify-center">
                                <i class="fas fa-minus text-xs"></i>
                            </button>
                            
                            <input type="number" id="qty-${itemId}" value="1" min="1" max="${availableQty}" 
                                   class="w-12 text-center bg-transparent border-none focus:ring-0 font-bold text-gray-700 text-lg p-0" readonly>
                            
                            <button onclick="window.adjustQty('${itemId}', 1)" class="w-8 h-8 rounded-full bg-white shadow-sm text-gray-600 hover:text-green-500 hover:shadow transition flex items-center justify-center">
                                <i class="fas fa-plus text-xs"></i>
                            </button>
                        </div>

                        <button onclick="window.addToCart('${itemId}')" 
                                class="w-full btn bg-green-500 hover:bg-green-600 text-white py-2.5 rounded-xl shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 ${availableQty === 0 ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}" 
                                ${availableQty === 0 ? 'disabled' : ''}>
                            <i class="fas fa-cart-plus"></i> เพิ่มลงตะกร้า
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
    
    if (currentUser) updateUIByRole();
}

function renderDispenseHistory(history) {
    console.log("Current User Role:", currentUser?.role, "Email:", currentUser?.email);
    const container = document.getElementById('dispense-history-list');
    if(!container) return;

    // --- 🔍 ส่วนที่เพิ่ม: กรองข้อมูลตามสิทธิ์ ---
    let displayData = history;
    
    // ถ้ามี user ล็อกอินอยู่ และ ไม่ใช่ Admin -> ให้กรองเอาเฉพาะของตัวเอง
    if (currentUser && currentUser.role !== 'Admin') {
        // 🔒 ถ้าไม่ใช่ Admin กรองเอาแค่ของตัวเอง
        displayData = history.filter(row => row.RequesterEmail === currentUser.email);
    }   
    // ------------------------------------------
    
    if (displayData.length === 0) {
        container.innerHTML = '<tr><td colspan="5" class="text-center p-4 text-gray-500">ไม่พบประวัติการเบิก</td></tr>';
        return;
    }

    // เปลี่ยนจาก history.map เป็น displayData.map
    container.innerHTML = displayData.map(row => {
        
        let statusClass = 'bg-gray-100 text-gray-800';
        let statusIcon = '';
        if (row.Status === 'Approved') { statusClass = 'bg-blue-100 text-blue-800'; statusIcon = '<i class="fas fa-check-circle mr-1"></i>'; }
        else if (row.Status === 'Completed') { statusClass = 'bg-green-100 text-green-800'; statusIcon = '<i class="fas fa-flag-checkered mr-1"></i>'; }
        else if (row.Status === 'Rejected') { statusClass = 'bg-red-100 text-red-800'; statusIcon = '<i class="fas fa-times-circle mr-1"></i>'; }
        else if (row.Status === 'Pending') { statusClass = 'bg-yellow-100 text-yellow-800'; statusIcon = '<i class="fas fa-clock mr-1"></i>'; }

        const attachmentHtml = row.AttachmentUrl 
            ? `<div class="mt-1">
                 <button type="button" onclick="window.viewAttachment('${row.id}')" class="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-white hover:bg-blue-500 bg-blue-50 px-2 py-1 rounded border border-blue-200 transition-all shadow-sm">
                    <i class="fas fa-paperclip"></i> ดูรูปใบเบิก
                 </button>
               </div>`
            : '';

        const signatureHtml = row.SignatureLink 
            ? `<div class="group relative">
                 <img src="${row.SignatureLink}" class="h-10 bg-white border border-gray-200 rounded p-0.5 cursor-pointer shadow-sm transition-transform duration-200 origin-right hover:scale-[4] hover:z-50 relative" onclick="window.open(this.src, '_blank')" alt="Signature">
               </div>` : '<span class="text-gray-400 text-xs">-</span>';

        return `
        <tr class="hover:bg-purple-50 transition-colors border-b last:border-0">
            <td class="p-3 align-top whitespace-nowrap">
                <div class="font-medium text-gray-700">${row.Timestamp.toLocaleDateString('th-TH')}</div>
                <div class="text-xs text-gray-400">${row.Timestamp.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</div>
            </td>
            <td class="p-3 align-top">
                <span class="px-2 py-1 text-xs font-bold rounded-full inline-flex items-center w-fit ${statusClass}">
                    ${statusIcon} ${row.Status}
                </span>
            </td>
            <td class="p-3 align-top">
                <div class="font-bold text-gray-700">${row.Requester}</div>
                <div class="text-xs text-gray-500">${row.Department}</div>
            </td>
            <td class="p-3 align-top">
                <div class="text-sm text-gray-800">${row.Items}</div>
                ${attachmentHtml}
            </td>
            <td class="p-3 align-top text-right">
                <div class="flex flex-col items-end">${signatureHtml}</div>
            </td>
        </tr>`;
    }).join('');
}

function renderPendingRequests(requests) {
    const container = document.getElementById('pending-requests-list');
    if(!container) return;
    if (requests.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-4">ไม่มีคำขอที่รออนุมัติ</p>';
        return;
    }
    container.innerHTML = requests.map(row => `
        <div class="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h4 class="font-bold text-gray-800">${row.Requester} <span class="text-sm font-normal text-gray-500">(${row.Department})</span></h4>
                    <p class="text-xs text-gray-400">วันที่ขอ: ${row.Timestamp.toLocaleDateString('th-TH')}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="window.approveProcess('${row.RequestCode}', '${row.id}')" class="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600">อนุมัติ</button>
                    <button onclick="window.rejectProcess('${row.RequestCode}')" class="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600">ปฏิเสธ</button>
                </div>
            </div>
            <div class="bg-gray-50 p-2 rounded text-sm border">
                <strong>รายการ:</strong> ${row.Items}
            </div>
        </div>`).join('');
}

function renderPickupList(requests) {
    const container = document.getElementById('pickup-list');
    if(!container) return;
    if (requests.length === 0) {
        container.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-gray-500">ไม่มีรายการรอรับของ</td></tr>';
        return;
    }
    container.innerHTML = requests.map(row => `
        <tr class="hover:bg-yellow-50 border-b">
            <td class="p-3 w-12"><input type="checkbox" class="pickup-checkbox h-5 w-5" data-code="${row.RequestCode}"></td>
            <td class="p-3">${row.ApprovalDate ? row.ApprovalDate.toLocaleDateString('th-TH') : '-'}</td>
            <td class="p-3">${row.Department}</td>
            <td class="p-3">${row.Requester}</td>
            <td class="p-3 text-sm">${row.ApprovedItems}</td>
            <td class="p-3 text-right">
                <button onclick="window.confirmPickup('${row.RequestCode}')" class="bg-yellow-500 text-white px-3 py-1 rounded text-xs hover:bg-yellow-600">ตัดยอด</button>
            </td>
        </tr>`).join('');
}

function renderReceiveHistory(history) {
    const container = document.getElementById('receive-history-list');
    if(!container) return;
    if (history.length === 0) {
        container.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-gray-500">ยังไม่มีประวัติการรับ</td></tr>';
        return;
    }
    container.innerHTML = history.map(row => `
        <tr class="hover:bg-indigo-50 border-b">
            <td class="p-3">${row.Timestamp.toLocaleDateString('th-TH')}</td>
            <td class="p-3 font-mono text-xs">${row.ReceiveCode}</td>
            <td class="p-3">${row.Receiver}</td>
            <td class="p-3 text-sm">${row.Items}</td>
        </tr>`).join('');
}

function renderUserList(users) {
    const container = document.getElementById('user-list-table');
    if(!container) return;
    container.innerHTML = users.map(user => `
        <tr class="hover:bg-gray-50 border-b">
            <td class="p-3 w-12">
                <img src="${user.photoURL || 'https://placehold.co/100x100/e2e8f0/888888?text=USER'}" 
                     class="w-10 h-10 rounded-full object-cover border border-gray-200 shadow-sm"
                     alt="Avatar">
            </td>
            <td class="p-3">
                <div class="font-bold text-gray-700 text-sm">${user.name || '-'}</div>
                <div class="text-xs text-gray-500">${user.email}</div>
            </td>
            <td class="p-3">
                <select onchange="window.saveUserRole('${user.email}', this.value, '${user.name}', '${user.photoURL || ''}')" class="border rounded p-1 text-xs">
                    <option value="User" ${user.role === 'User' ? 'selected' : ''}>User</option>
                    <option value="Admin" ${user.role === 'Admin' ? 'selected' : ''}>Admin</option>
                </select>
            </td>
        </tr>`).join('');
}

function renderDepartmentList(depts) {
    const container = document.getElementById('department-list');
    if(!container) return;
    if (depts.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center p-2">ยังไม่มีแผนก</p>';
        return;
    }
    container.innerHTML = depts.map(d => `
        <div class="flex justify-between items-center p-2 hover:bg-gray-100 rounded border-b">
            <span>${d}</span>
            <button onclick="window.deleteDept('${d}')" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
        </div>`).join('');
}

function renderStockTakePage() {
    const container = document.getElementById('stocktake-list');
    if(!container) return;
    const searchInput = document.getElementById('stocktake-search-input')?.value.toLowerCase() || '';
    const categoryFilter = document.getElementById('stocktake-category-filter')?.value || 'all';
    
    const categorySelect = document.getElementById('stocktake-category-filter');
    if (categorySelect && categorySelect.options.length <= 1) {
        const categories = [...new Set(ppeItemsCache.map(i => i.category))].filter(Boolean).sort();
        categories.forEach(cat => {
            const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; categorySelect.appendChild(opt);
        });
    }

    let filtered = ppeItemsCache.filter(item => {
        const matchesSearch = (item.name || '').toLowerCase().includes(searchInput) || (item.code || '').toLowerCase().includes(searchInput);
        const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    if (filtered.length === 0) { container.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-gray-500">ไม่พบรายการ</td></tr>'; return; }
    container.innerHTML = filtered.sort((a, b) => a.name.localeCompare(b.name)).map(item => `
        <tr class="border-b hover:bg-teal-50" data-item-code="${item.code}" data-system-qty="${item.totalQuantity}">
            <td class="p-3"><span class="font-medium">${item.name}</span><br><span class="text-xs text-gray-500">(${item.code})</span></td>
            <td class="p-3 text-center">${item.unit}</td>
            <td class="p-3 text-center font-semibold text-purple-700">${item.totalQuantity}</td>
            <td class="p-3 text-center"><input type="number" class="stocktake-qty-input border p-1 rounded w-full text-center shadow-inner" min="0" placeholder="${item.totalQuantity}" data-code="${item.code}"></td>
        </tr>`).join('');
}

// ✅ FIX: ฟังก์ชันตั้งค่ากระดานเซ็นชื่อ (แก้ปัญหาเซ็นไม่ติด)
function initSignaturePad(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (canvas) {
        // คำนวณขนาดให้พอดีกับหน้าจอ (แก้ปัญหา Canvas กว้าง 0)
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext("2d").scale(ratio, ratio);

        // สร้าง Signature Pad ใหม่
        const pad = new SignaturePad(canvas, { 
            backgroundColor: 'rgb(255, 255, 255)',
            penColor: 'rgb(0, 0, 0)'
        });
        
        pad.off(); // เริ่มต้นแบบล็อก (เขียนไม่ได้ จนกว่าจะติ๊กถูก)
        return pad;
    }
    return null;
}

// --- 5. SETUP LISTENERS ---

function setupEventListeners() {
    // --- 1. EXPORT FUNCTIONS TO WINDOW (เพื่อให้ HTML เรียกใช้ได้) ---
    window.login = () => window.signInWithPopup(window.auth, window.provider).catch(e => alert(e.message));
    window.logout = () => window.signOut(window.auth).then(() => location.reload());
    window.refreshData = refreshAllData;
    window.addToCart = addToCart;
    window.removeFromCart = removeFromCart;
    window.updateCartItem = updateCartItem;
    window.editItem = editItem;
    
    // Action Wrappers
    window.deleteItem = (id) => {
        confirmationDetails = { action: 'delete_item', itemCode: id };
        openConfirmationModal('ยืนยันลบ', 'ต้องการลบอุปกรณ์นี้ใช่หรือไม่?', 'delete_item', { itemCode: id });
    };
    window.saveUserRole = (email, role, name) => setUserRole(email, role, name);
    window.deleteDept = (name) => {
        confirmationDetails = { action: 'delete_department', departmentName: name };
        openConfirmationModal('ยืนยันลบแผนก', `ต้องการลบแผนก ${name} ใช่หรือไม่?`, 'delete_department', { departmentName: name });
    };
    window.confirmPickup = (code) => {
        confirmationDetails = { action: 'confirm_pickup', requestCode: code };
        openConfirmationModal('ยืนยันตัดยอด', 'ผู้เบิกได้รับของเรียบร้อยแล้วใช่หรือไม่?', 'confirm_pickup', { requestCode: code });
    };
    window.approveProcess = (requestCode, docId) => {
        const request = dispenseHistoryCache.find(r => r.id === docId);
        if (request) {
            document.getElementById('approval-request-code').textContent = requestCode;
            document.getElementById('approval-requester-name').textContent = request.Requester;
            
            const list = document.getElementById('approval-item-list');
            list.innerHTML = '';
            request.RawItems.forEach(item => {
                const stockItem = ppeItemsCache.find(i => i.code === item.itemCode || i.name === item.itemName);
                const maxStock = stockItem ? stockItem.totalQuantity : 0;
                const div = document.createElement('div');
                div.className = "flex justify-between items-center bg-gray-50 p-2 rounded mb-2 text-sm";
                div.innerHTML = `<span>${item.itemName} (ขอ: ${item.quantity})</span><div class="flex items-center gap-2"><span class="text-xs text-gray-500">คลัง: ${maxStock}</span><input type="number" class="approved-quantity border w-16 text-center rounded" value="${item.quantity}" min="0" max="${maxStock}" data-item-code="${item.itemCode}" data-item-name="${item.itemName}"></div>`;
                list.appendChild(div);
            });
            document.getElementById('approval-modal').classList.remove('hidden');
        }
    };
    window.rejectProcess = (code) => {
        document.getElementById('rejection-request-code').value = code;
        document.getElementById('rejection-modal').classList.remove('hidden');
    };

    // --- 2. NAVIGATION & MENU ---
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showPage(e.currentTarget.dataset.page));
    });
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
        document.getElementById('main-nav-wrapper').classList.toggle('hidden');
    });

    // --- 3. MODAL OPENERS ---
    document.getElementById('open-add-item-modal-btn')?.addEventListener('click', () => {
        document.getElementById('item-form').reset();
        document.getElementById('item-doc-id').value = "";
        document.getElementById('item-current-image-url').value = "";
        document.getElementById('item-modal').classList.remove('hidden');
    });
    document.getElementById('cart-button')?.addEventListener('click', () => document.getElementById('cart-modal').classList.remove('hidden'));
    document.getElementById('open-receive-modal-btn')?.addEventListener('click', () => {
        // 1. เคลียร์ค่าเดิม
        document.getElementById('receive-form').reset();
        document.getElementById('receive-item-list').innerHTML = '';
        addReceiveItemRow();

        // 2. สร้างเลขรันอัตโนมัติ (Format: RCV-ปีเดือนวัน-ชั่วโมงนาทีวินาที)
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        
        const autoCode = `RCV-${y}${m}${d}-${h}${min}${s}`;

        // 3. ใส่ค่าลงในช่อง Input ทันที
        document.getElementById('receive-code').value = autoCode;
        
        // 4. ตั้งค่าวันที่ปัจจุบันให้ด้วย (เพื่อความสะดวก)
        document.getElementById('receive-date').valueAsDate = new Date();

        // 5. แสดงหน้าต่าง
        document.getElementById('receive-modal').classList.remove('hidden');
    });

    // --- 4. SEARCH & FILTER ---
    document.getElementById('search-input')?.addEventListener('input', filterAndRenderInventory);
    document.getElementById('category-filter')?.addEventListener('change', filterAndRenderInventory);
    document.getElementById('stocktake-search-input')?.addEventListener('input', renderStockTakePage);
    document.getElementById('stocktake-category-filter')?.addEventListener('change', renderStockTakePage);

    // --- 5. FORM SUBMISSIONS ---

    // 5.1 Item Form (With Image Upload)
    document.getElementById('item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoading();
        let imageUrl = document.getElementById('item-current-image-url').value;
        const fileInput = document.getElementById('item-image-file');
        try {
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                if (file.size > 700000) { alert("รูปภาพใหญ่เกินไป (ต้องไม่เกิน 700KB)"); hideLoading(); return; }
                imageUrl = await convertBase64(file);
            }
            const formData = {
                id: document.getElementById('item-doc-id').value,
                code: document.getElementById('item-code').value,
                name: document.getElementById('item-name').value,
                totalQuantity: parseInt(document.getElementById('item-quantity').value),
                unit: document.getElementById('item-unit').value,
                minStock: 5, category: "General",
                imageUrl: imageUrl,
                details: document.getElementById('item-details').value
            };
            await saveInventoryItem(formData);
        } catch (error) { console.error(error); alert("Error: " + error.message); hideLoading(); }
    });

    // 5.2 Dispense Flow (Cart -> Modal -> Signature)
    document.getElementById('confirm-dispense-btn')?.addEventListener('click', () => {
        if(confirm("ยืนยันการเบิกสินค้า?")) {
            closeModal('cart-modal');
            
            // 1. เตรียมข้อมูลในฟอร์ม
            document.getElementById('dispense-form').reset();
            document.getElementById('dispense-code').value = `REQ-${Date.now()}`;
            document.getElementById('dispense-date').valueAsDate = new Date();
            
            // ใส่ชื่อผู้เบิกอัตโนมัติ (ถ้ามี User)
            if(currentUser && currentUser.displayName) {
                 document.getElementById('dispense-requester').value = currentUser.displayName;
            }

            // เติมข้อมูลแผนกใน Dropdown
            populateDepartmentDropdown(departmentsCache, 'dispense-department');
            
            // สร้างรายการสินค้าแสดงผล
            document.getElementById('dispense-item-list').innerHTML = dispenseCart.map(i => 
                `<div class="flex justify-between text-sm border-b py-2">
                    <span>${i.name}</span>
                    <span class="font-bold">x${i.quantity} ${i.unit}</span>
                </div>`
            ).join('');
            
            // 2. รีเซ็ตสถานะการเซ็นชื่อ
            const sigCheckbox = document.getElementById('signature-confirm-checkbox');
            const sigOverlay = document.getElementById('signature-overlay');
            
            if (sigCheckbox) sigCheckbox.checked = false;
            if (sigOverlay) sigOverlay.classList.remove('hidden');

            // 3. เปิด Modal
            document.getElementById('dispense-modal').classList.remove('hidden');
            
            // 4. 🔥 สำคัญมาก: รอให้ Modal กางสุดก่อน ค่อยสร้างกระดานเซ็น
            setTimeout(() => {
                signaturePad = initSignaturePad('signature-pad'); 
            }, 300); // เพิ่มเวลาหน่วงเป็น 300ms
        }
    });

    // --- FIX: Checkbox Toggle ---
    document.getElementById('signature-confirm-checkbox')?.addEventListener('change', (e) => {
        const overlay = document.getElementById('signature-overlay');
        if (e.target.checked) {
            overlay.classList.add('hidden'); // ซ่อนตัวบัง
            if(signaturePad) signaturePad.on(); // เปิดให้เซ็น
        } else {
            overlay.classList.remove('hidden'); // แสดงตัวบัง
            if(signaturePad) {
                signaturePad.off(); 
                signaturePad.clear();
            }
        }
    });

    // --- FIX: Submit Dispense Form ---
    document.getElementById('dispense-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        
        if (!document.getElementById('signature-confirm-checkbox').checked) { 
            alert("กรุณาติ๊ก 'ข้าพเจ้ายืนยันการเบิก' ก่อนครับ"); 
            return; 
        }
        
        if (!signaturePad || signaturePad.isEmpty()) { 
            alert("กรุณาเซ็นชื่อผู้เบิกด้วยครับ"); 
            return; 
        }
        
        const formData = {
            requestDate: document.getElementById('dispense-date').value,
            department: document.getElementById('dispense-department').value,
            requesterName: document.getElementById('dispense-requester').value,
            items: dispenseCart.map(i => ({ itemCode: i.code, itemName: i.name, quantity: i.quantity })),
            signatureImage: signaturePad.toDataURL() // แปลงลายเซ็นเป็นรูปภาพ
        };
        
        submitDispenseRequest(formData);
    });

// --- 5.5 Walk-in Flow (Admin) ---
    document.getElementById('add-walkin-item-btn')?.addEventListener('click', addWalkInItemRow);
    
    // Walk-in Signature Checkbox Logic (แก้ไขใหม่)
    document.getElementById('walkin-signature-confirm-checkbox')?.addEventListener('change', (e) => {
        const overlay = document.getElementById('walkin-signature-overlay');
        
        // 1. ถ้ายังไม่มีกระดาน ให้สร้างใหม่ทันที
        if (!walkinSignaturePad) {
            walkinSignaturePad = initSignaturePad('walkin-signature-pad');
        }
        
        if (e.target.checked) {
            // ติ๊กถูก: ซ่อนตัวบัง และ เปิดให้เขียน
            overlay.classList.add('hidden'); 
            if (walkinSignaturePad) walkinSignaturePad.on();
        } else {
            // เอาติ๊กออก: แสดงตัวบัง, ล็อกกระดาน และล้างข้อมูล
            overlay.classList.remove('hidden');
            if (walkinSignaturePad) { 
                walkinSignaturePad.off(); 
                walkinSignaturePad.clear(); 
            }
        }
    });

    // ปุ่มล้างลายเซ็น (เพิ่มการทำงาน)
    document.getElementById('walkin-clear-signature-btn')?.addEventListener('click', () => {
        if (walkinSignaturePad) {
            walkinSignaturePad.clear();
        }
    });

    // Walk-in Submit (แก้ไขส่วนการดึงค่าลายเซ็น)
    document.getElementById('walkin-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const items = Array.from(document.querySelectorAll('.walkin-item-row')).map(row => {
            const select = row.querySelector('select');
            const input = row.querySelector('input');
            return { itemCode: select.value, itemName: select.options[select.selectedIndex].text, quantity: parseInt(input.value) };
        }).filter(i => i.itemCode && i.quantity > 0);
        
        if(!walkinSignaturePad) walkinSignaturePad = initSignaturePad('walkin-signature-pad');
        
        // Validation for Walkin
        const checkbox = document.getElementById('walkin-signature-confirm-checkbox');
        if (checkbox && !checkbox.checked) { alert("กรุณายืนยันข้อมูลก่อนเซ็น"); return; }

        const walkInData = {
            requesterName: document.getElementById('walkin-requester').value,
            department: document.getElementById('walkin-department').value,
            items: items,
            signatureImageBase64: (walkinSignaturePad && !walkinSignaturePad.isEmpty()) ? walkinSignaturePad.toDataURL() : ''
        };
        
        confirmationDetails = { action: 'walkin_dispense', walkInData: walkInData };
        openConfirmationModal('ยืนยันเบิกด่วน', 'ตัดสต็อกทันที?', 'walkin_dispense', {});
    });

    // 5.6 Receive Form
    document.getElementById('add-receive-item-btn')?.addEventListener('click', addReceiveItemRow);
    document.getElementById('receive-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const items = Array.from(document.querySelectorAll('.receive-item-row')).map(row => {
            const select = row.querySelector('select');
            const input = row.querySelector('input');
            return { itemCode: select.value, itemName: select.options[select.selectedIndex].text, quantity: parseInt(input.value) };
        }).filter(i => i.itemCode && i.quantity > 0);
        processReceiveForm({
            receiveCode: document.getElementById('receive-code').value || `RCV-${Date.now()}`,
            receiveDate: document.getElementById('receive-date').value,
            receiverName: document.getElementById('receive-receiver').value,
            items: items
        });
    });

    // 5.7 Other Forms
    document.getElementById('approval-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('approval-request-code').textContent;
        const approvedItems = Array.from(document.querySelectorAll('.approved-quantity')).map(inp => ({
            itemCode: inp.dataset.itemCode, itemName: inp.dataset.itemName, quantity: parseInt(inp.value)
        }));
        approveRequest(code, approvedItems);
    });
    document.getElementById('rejection-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        rejectRequest(document.getElementById('rejection-request-code').value, document.getElementById('rejection-reason').value);
    });
    document.getElementById('department-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        addDepartment(document.getElementById('department-name').value);
    });
    document.getElementById('add-user-form')?.addEventListener('submit', (e) => {
        e.preventDefault(); // Prevent reload
        // Manual Add User is tricky in Client SDK without Cloud Functions, usually rely on auto-register
        alert("ระบบจะเพิ่มผู้ใช้ให้อัตโนมัติเมื่อพวกเขาล็อกอินครับ");
    });
    document.getElementById('adjustment-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const adjData = {
            itemCode: document.getElementById('adj-item-select').value,
            quantity: parseInt(document.getElementById('adj-quantity-input').value),
            mode: document.querySelector('input[name="adj-mode"]:checked').value,
            reason: document.getElementById('adj-reason').value
        };
        confirmationDetails = { action: 'adjust_stock', adjData: adjData };
        openConfirmationModal('ยืนยันปรับสต็อก', 'ยืนยันการปรับเปลี่ยน?', 'adjust_stock', {});
    });
    document.getElementById('stocktake-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const adjustments = [];
        document.querySelectorAll('#stocktake-list tr').forEach(row => {
            const input = row.querySelector('input');
            if (input.value) {
                adjustments.push({ itemCode: row.dataset.itemCode, newQuantity: parseInt(input.value) });
            }
        });
        confirmationDetails = { action: 'stock_take_confirm', adjustments: adjustments };
        openConfirmationModal('ยืนยันตรวจนับ', `ปรับปรุง ${adjustments.length} รายการ?`, 'stock_take_confirm', {});
    });
    document.getElementById('generate-report-btn')?.addEventListener('click', () => {
        generateReport({
            type: document.getElementById('report-type').value,
            month: document.getElementById('report-month').value,
            year: document.getElementById('report-year').value,
            itemCode: document.getElementById('report-item').value
        });
    });

    // --- 6. CONFIRMATION MODAL ACTION ---
    document.getElementById('confirm-action-btn')?.addEventListener('click', () => {
        if (confirmationDetails.action === 'delete_department') deleteDepartment(confirmationDetails.departmentName);
        else if (confirmationDetails.action === 'confirm_pickup') {
        processConfirmPickup(confirmationDetails.requestCode);
    }
        else if (confirmationDetails.action === 'delete_item') deleteInventoryItem(confirmationDetails.itemCode);
        else if (confirmationDetails.action === 'walkin_dispense') processWalkInDispense(confirmationDetails.walkInData);
        else if (confirmationDetails.action === 'adjust_stock') processStockAdjustment(confirmationDetails.adjData);
        else if (confirmationDetails.action === 'stock_take_confirm') processStockAdjustment({ adjustments: confirmationDetails.adjustments });
    });

    window.submitUserForm = async () => {
        const email = document.getElementById('new-user-email').value;
        const role = document.getElementById('new-user-role').value;
        const name = document.getElementById('new-user-name').value;
        const fileInput = document.getElementById('new-user-image');
        
        let photoBase64 = null;

        // ถ้ามีการเลือกไฟล์
        if (fileInput.files && fileInput.files[0]) {
            try {
                // บีบอัดรูปก่อนส่ง
                photoBase64 = await compressImage(fileInput.files[0]);
            } catch (error) {
                console.error("Image Error:", error);
                alert("เกิดข้อผิดพลาดในการประมวลผลรูปภาพ");
                return;
            }
        }

        // เรียกฟังก์ชันบันทึกหลัก
        await setUserRole(email, role, name, photoBase64);
    };

    window.viewAttachment = (id) => {
        const item = dispenseHistoryCache.find(x => x.id === id);
        if (item && item.AttachmentUrl) {
            const modal = document.getElementById('image-viewer-modal');
            const img = document.getElementById('image-viewer-content');
            const dlBtn = document.getElementById('image-download-btn');
            
            // ตั้งค่ารูปภาพ
            img.src = item.AttachmentUrl;
            dlBtn.href = item.AttachmentUrl; // ตั้งค่าลิงก์ดาวน์โหลด
            
            // แสดง Modal
            modal.classList.remove('hidden');
            // ทำ Animation Fade In
            requestAnimationFrame(() => {
                modal.classList.remove('opacity-0');
            });
        } else {
            alert("ไม่พบข้อมูลรูปภาพ");
        }
    };

    window.closeImageViewer = () => {
        const modal = document.getElementById('image-viewer-modal');
        modal.classList.add('opacity-0');
        // รอ Animation จบแล้วค่อยซ่อน (300ms)
        setTimeout(() => {
            modal.classList.add('hidden');
            document.getElementById('image-viewer-content').src = ''; // เคลียร์รูป
        }, 300);
    };
}

// --- 6. HELPERS ---
function showLoading() { document.getElementById('loading-overlay').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
function showPage(pageId) {
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const page = document.getElementById(`page-${pageId}`);
    const btn = document.querySelector(`.nav-btn[data-page='${pageId}']`);
    if(page) page.classList.add('active');
    if(btn) btn.classList.add('active');
    const mobileTitle = document.getElementById('mobile-page-title');
    if(mobileTitle && btn) mobileTitle.textContent = btn.textContent.trim();
    if(pageId === 'stocktake') renderStockTakePage();
}
function convertBase64(file) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.readAsDataURL(file);
        fileReader.onload = () => resolve(fileReader.result);
        fileReader.onerror = (error) => reject(error);
    });
}
function openConfirmationModal(title, msg, action, details) {
    document.getElementById('confirmation-title').textContent = title;
    document.getElementById('confirmation-message').textContent = msg;
    document.getElementById('confirmation-modal').classList.remove('hidden');
}
function editItem(id) { 
    const item = ppeItemsCache.find(i => i.id === id);
    if(item) {
        document.getElementById('item-doc-id').value = item.id;
        document.getElementById('item-code').value = item.code || '';
        document.getElementById('item-name').value = item.name || '';
        document.getElementById('item-quantity').value = item.totalQuantity || 0;
        document.getElementById('item-unit').value = item.unit || '';
        document.getElementById('item-details').value = item.details || '';
        document.getElementById('item-current-image-url').value = item.imageUrl || '';
        document.getElementById('item-modal').classList.remove('hidden');
    }
}
function applySeasonalTheme() {
    const m = new Date().getMonth();
    if(m===9) document.body.classList.add('halloween-theme');
    else if(m===11) document.body.classList.add('christmas-theme');
    else if(m===1) document.body.classList.add('valentine-theme');
}
function runFlyAnimation(itemId) {
    // 1. หาปุ่มที่ถูกกด เพื่อจะย้อนกลับไปหารูปภาพต้นทาง
    const btn = document.querySelector(`button[onclick="window.addToCart('${itemId}')"]`);
    if (!btn) return;

    // หา element Card ที่ครอบปุ่มนี้อยู่
    const card = btn.closest('.relative'); 
    // หารูปภาพใน Card นั้น
    const srcImg = card.querySelector('img');
    
    // หาปุ่มตะกร้าปลายทาง
    const cartBtn = document.getElementById('cart-button');

    if (srcImg && cartBtn) {
        // 2. สร้างภาพจำลอง (Clone)
        const flyer = srcImg.cloneNode();
        
        // รับค่าตำแหน่งเริ่มต้น (รูปสินค้า) และ ปลายทาง (ตะกร้า)
        const startRect = srcImg.getBoundingClientRect();
        
        // บังคับให้ตะกร้าแสดงผลก่อน (เผื่อมันซ่อนอยู่) เพื่อให้หาตำแหน่งได้
        cartBtn.classList.remove('hidden'); 
        const endRect = cartBtn.getBoundingClientRect();

        // 3. ตั้งค่าเริ่มต้นให้ภาพจำลอง
        flyer.classList.add('fly-item');
        flyer.style.left = startRect.left + 'px';
        flyer.style.top = startRect.top + 'px';
        flyer.style.width = startRect.width + 'px';
        flyer.style.height = startRect.height + 'px';

        document.body.appendChild(flyer);

        // 4. สั่งให้เริ่มบิน (ใช้ setTimeout นิดนึงเพื่อให้ Browser รับรู้ค่าเริ่มต้นก่อน)
        setTimeout(() => {
            flyer.style.left = (endRect.left + 10) + 'px'; // +10 เพื่อให้เข้ากลางๆ ตะกร้า
            flyer.style.top = (endRect.top + 10) + 'px';
            flyer.style.width = '30px'; // หดเล็กลง
            flyer.style.height = '30px';
            flyer.style.opacity = '0.5'; // จางลง
        }, 10);

        // 5. ลบภาพทิ้งเมื่อบินถึง (0.8 วินาที ตาม CSS)
        setTimeout(() => {
            flyer.remove();
            
            // สั่งให้ตะกร้าเด้งรับ (Animation เดิม)
            cartBtn.classList.remove('cart-updated');
            void cartBtn.offsetWidth; 
            cartBtn.classList.add('cart-updated');

        }, 800);
    }
}

// --- ฟังก์ชันหลัก (อัปเดตใหม่) ---
function addToCart(id) { 
    const item = ppeItemsCache.find(i => i.id === id);
    if (!item) return;

    // ✅ เรียกใช้ Animation รูปบิน!
    runFlyAnimation(id);

    // --- Animation ปุ่มกด ---
    const btn = document.querySelector(`button[onclick="window.addToCart('${id}')"]`);
    if (btn) {
        btn.classList.add('btn-clicked');
        setTimeout(() => btn.classList.remove('btn-clicked'), 200);
    }

    // --- Logic คำนวณ (เหมือนเดิม) ---
    const inputElement = document.getElementById(`qty-${id}`);
    let qty = parseInt(inputElement.value) || 1;

    const pendingQty = dispenseHistoryCache
        .filter(req => req.Status === 'Pending')
        .reduce((sum, req) => {
            const match = req.RawItems.find(r => r.itemCode === item.code || r.itemName === item.name);
            return sum + (match ? parseInt(match.quantity || 0) : 0);
        }, 0);

    const inCartQty = dispenseCart.find(c => c.id === id)?.quantity || 0;
    const realAvailable = item.totalQuantity - pendingQty;
    const remainingQuota = realAvailable - inCartQty; 

    if (qty > remainingQuota) {
        qty = remainingQuota; 
        inputElement.value = qty; 
    }

    if (qty <= 0) return; 

    // --- เพิ่มลงตะกร้า ---
    const exist = dispenseCart.find(c => c.id === id);
    if (exist) {
        exist.quantity += qty;
    } else {
        dispenseCart.push({
            id: item.id,
            code: item.code,
            name: item.name,
            unit: item.unit,
            quantity: qty,
            imageUrl: item.imageUrl,
            max: item.totalQuantity
        });
    }

    // หมายเหตุ: ย้าย updateCartUI ไปไว้หลัง Animation บินจบก็ได้ 
    // แต่ไว้ตรงนี้เพื่อให้เลขขึ้นทันทีจะรู้สึกเร็วกว่า
    updateCartUI();
}

// ฟังก์ชันสำหรับปุ่ม บวก/ลบ จำนวนในหน้าการ์ด
function adjustQty(id, amount) {
    const input = document.getElementById(`qty-${id}`);
    if (!input) return;
    
    let currentVal = parseInt(input.value) || 1;
    let maxVal = parseInt(input.getAttribute('max')) || 999;
    
    // คำนวณค่าใหม่
    let newVal = currentVal + amount;
    
    // ห้ามต่ำกว่า 1 และห้ามเกินจำนวนที่มี
    if (newVal >= 1 && newVal <= maxVal) {
        input.value = newVal;
    }
}
// อย่าลืมบรรทัดนี้ เพื่อให้ HTML เรียกใช้ได้
window.adjustQty = adjustQty;

function removeFromCart(id) { dispenseCart = dispenseCart.filter(c=>c.id!==id); updateCartUI(); }
function updateCartItem(id, chg) {
    const item = dispenseCart.find(c=>c.id===id);
    if(item) { const n = item.quantity+chg; if(n>0 && n<=item.max) item.quantity=n; updateCartUI(); }
}
function updateCartUI() {
    const b = document.getElementById('cart-badge');
    const c = document.getElementById('cart-item-list');
    const t = dispenseCart.reduce((s,i)=>s+i.quantity,0);
    b.textContent = t; b.classList.toggle('hidden', t===0);
    if(t===0) { c.innerHTML='<p class="text-center text-gray-400 mt-4">ว่างเปล่า</p>'; document.getElementById('confirm-dispense-btn').disabled=true; }
    else {
        document.getElementById('confirm-dispense-btn').disabled=false;
        c.innerHTML = dispenseCart.map(i=>`<div class="flex justify-between border-b p-2"><span>${i.name}</span><div class="flex gap-2"><button onclick="updateCartItem('${i.id}',-1)">-</button><span>${i.quantity}</span><button onclick="updateCartItem('${i.id}',1)">+</button><button onclick="removeFromCart('${i.id}')" class="text-red-500">x</button></div></div>`).join('');
    }
}
function populateDepartmentDropdown(depts, id) {
    const el = document.getElementById(id);
    if(el) { el.innerHTML='<option value="">--เลือกแผนก--</option>'; depts.forEach(d=>el.innerHTML+=`<option value="${d}">${d}</option>`); }
}
function populateHistoryDepartmentFilter(depts) { populateDepartmentDropdown(depts, 'history-dept-filter'); }
function populateAdjustmentDropdown() {
    const el = document.getElementById('adj-item-select');
    if(el) { el.innerHTML='<option value="">--เลือกอุปกรณ์--</option>'; ppeItemsCache.forEach(i=>el.innerHTML+=`<option value="${i.code}">${i.name}</option>`); }
}
function populateReportItemDropdown() {
    const el = document.getElementById('report-item');
    if(el) { el.innerHTML='<option value="all">ทั้งหมด</option>'; ppeItemsCache.forEach(i=>el.innerHTML+=`<option value="${i.code}">${i.name}</option>`); }
}
function addReceiveItemRow() {
    const d = document.createElement('div'); d.className='receive-item-row flex gap-2 mb-2';
    d.innerHTML = `<select class="border p-2 flex-1"><option value="">เลือกของ</option>${ppeItemsCache.map(i=>`<option value="${i.code}">${i.name}</option>`).join('')}</select><input type="number" class="border p-2 w-20" placeholder="qty"><button type="button" onclick="this.parentElement.remove()" class="text-red-500">X</button>`;
    document.getElementById('receive-item-list').appendChild(d);
}
function addWalkInItemRow() {
    const d = document.createElement('div'); d.className='walkin-item-row flex gap-2 mb-2';
    d.innerHTML = `<select class="border p-2 flex-1"><option value="">เลือกของ</option>${ppeItemsCache.map(i=>`<option value="${i.code}">${i.name}</option>`).join('')}</select><input type="number" class="border p-2 w-20" placeholder="qty"><button type="button" onclick="this.parentElement.remove()" class="text-red-500">X</button>`;
    document.getElementById('walkin-item-list').appendChild(d);
}

// --- Helper: บีบอัดรูปภาพให้เล็ก (สำหรับ Avatar) ---
function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                // คำนวณขนาดใหม่ (รักษาอัตราส่วน)
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // แปลงเป็น Base64 (JPEG quality 0.7)
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

// --- เพิ่มใหม่: ฟังก์ชันแสดงหน้าต่างกรอกชื่อหลัง Login ---
function showNameInputModal() {
    // ซ่อน Loading ถ้ามี
    hideLoading();
    
    // สร้าง Modal HTML
    let modal = document.getElementById('name-input-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'name-input-modal';
        modal.className = "fixed inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 z-50";
        modal.innerHTML = `
            <div class="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full text-center">
                <h2 class="text-2xl font-bold text-gray-800 mb-4">👋 ยินดีต้อนรับ!</h2>
                <p class="text-gray-600 mb-6">กรุณาระบุ "ชื่อ-นามสกุล" หรือ "ชื่อเล่น" ที่ต้องการใช้ในระบบ</p>
                
                <input type="text" id="custom-name-input" 
                       class="w-full border-2 border-gray-300 rounded-lg p-3 text-lg focus:border-blue-500 focus:outline-none mb-4" 
                       placeholder="เช่น สมชาย แผนกช่าง..." autofocus>
                
                <button onclick="saveCustomNameAndContinue()" 
                        class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition shadow-lg">
                    บันทึกและเข้าใช้งาน
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
}

// --- เพิ่มใหม่: ฟังก์ชันบันทึกชื่อลง Firebase แล้วเข้าแอป ---
async function saveCustomNameAndContinue() {
    const nameInput = document.getElementById('custom-name-input').value.trim();
    if (!nameInput) return alert("กรุณากรอกชื่อก่อนครับ");

    showLoading();
    try {
        const { db, doc, updateDoc } = window;
        
        // 1. อัปเดตชื่อลงฐานข้อมูล Firestore
        const userRef = doc(db, COLLECTIONS.USERS, currentUser.email);
        await updateDoc(userRef, { 
            name: nameInput,
            updatedAt: new Date()
        });

        // 2. อัปเดตตัวแปรในเครื่อง (Local)
        currentUser.displayName = nameInput; // บังคับเปลี่ยนชื่อในตัวแปร Login
        
        // 3. ปิด Modal และเข้าแอป
        const modal = document.getElementById('name-input-modal');
        if (modal) modal.remove();

        showAppInterface(); // เข้าหน้าหลัก
        refreshAllData();   // โหลดข้อมูล

    } catch (e) {
        console.error(e);
        alert("เกิดข้อผิดพลาด: " + e.message);
    } finally {
        hideLoading();
    }
}

// --- เพิ่มใหม่: ฟังก์ชันบันทึกชื่อลง Firebase แล้วเข้าแอป ---
async function saveCustomNameAndContinue() {
    const nameInput = document.getElementById('custom-name-input').value.trim();
    if (!nameInput) return alert("กรุณากรอกชื่อก่อนครับ");

    showLoading();
    try {
        const { db, doc, updateDoc } = window;
        
        // 1. อัปเดตชื่อลงฐานข้อมูล Firestore
        const userRef = doc(db, COLLECTIONS.USERS, currentUser.email);
        await updateDoc(userRef, { 
            name: nameInput,
            updatedAt: new Date()
        });

        // 2. อัปเดตตัวแปรในเครื่อง (Local)
        currentUser.displayName = nameInput; // บังคับเปลี่ยนชื่อในตัวแปร Login
        
        // 3. ปิด Modal และเข้าแอป
        const modal = document.getElementById('name-input-modal');
        if (modal) modal.remove();

        showAppInterface(); // เข้าหน้าหลัก
        refreshAllData();   // โหลดข้อมูล

    } catch (e) {
        console.error(e);
        alert("เกิดข้อผิดพลาด: " + e.message);
    } finally {
        hideLoading();
    }
}

