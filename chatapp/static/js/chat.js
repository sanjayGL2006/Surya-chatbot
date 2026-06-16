/* =========================================================
   Surya chatbot - Chat client logic
   ========================================================= */

// ---------------------------------------------------------
// State
// ---------------------------------------------------------
const socket = io();

let currentRoom = "General";
let currentRoomType = "group";       // "group" | "private"
let currentTargetUser = null;        // for private chats
let typingTimeout = null;
let onlineUsersList = [];
const unreadCounts = {};             // { roomKey: count }

// DOM elements
const messagesList = document.getElementById("messagesList");
const messagesContainer = document.getElementById("messagesContainer");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const typingIndicator = document.getElementById("typingIndicator");
const chatRoomName = document.getElementById("chatRoomName");
const chatSubtitle = document.getElementById("chatSubtitle");
const chatTitleIcon = document.getElementById("chatTitleIcon");
const onlineCount = document.getElementById("onlineCount");
const toastContainer = document.getElementById("toastContainer");

// Sidebar elements
const sidebar = document.getElementById("sidebar");
const openSidebarBtn = document.getElementById("openSidebar");
const closeSidebarBtn = document.getElementById("closeSidebar");

// Room creation
const addRoomBtn = document.getElementById("addRoomBtn");
const addRoomForm = document.getElementById("addRoomForm");
const newRoomNameInput = document.getElementById("newRoomName");
const createRoomBtn = document.getElementById("createRoomBtn");

// File upload
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const uploadProgress = document.getElementById("uploadProgress");
const uploadProgressBar = document.getElementById("uploadProgressBar");

// Emoji picker
const emojiBtn = document.getElementById("emojiBtn");
const emojiPicker = document.getElementById("emojiPicker");

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function getRoomKey() {
    return currentRoomType === "private"
        ? privateRoomName(CURRENT_USER, currentTargetUser)
        : currentRoom;
}

function privateRoomName(a, b) {
    const names = [a, b].sort();
    return `private__${names[0]}__${names[1]}`;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(ts) {
    if (!ts) return "";
    // ts format: "YYYY-MM-DD HH:MM:SS"
    const date = new Date(ts.replace(" ", "T"));
    if (isNaN(date.getTime())) return ts;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showToast(title, body) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(body)}</div>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ---------------------------------------------------------
// Browser notifications
// ---------------------------------------------------------
function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}
requestNotificationPermission();

function notifyNewMessage(sender, content, roomKey) {
    if (roomKey === getRoomKey() && document.hasFocus()) return; // already viewing

    // Update unread badge
    unreadCounts[roomKey] = (unreadCounts[roomKey] || 0) + 1;
    updateUnreadBadge(roomKey);

    if ("Notification" in window && Notification.permission === "granted" && !document.hasFocus()) {
        new Notification(`New message from ${sender}`, {
            body: content || "Sent an attachment",
            icon: "/static/img/icon.png"
        });
    }
    showToast(sender, content || "Sent an attachment");
}

function updateUnreadBadge(roomKey) {
    const count = unreadCounts[roomKey] || 0;
    document.querySelectorAll(`[data-room-badge]`).forEach((badge) => {
        const item = badge.closest(".room-item");
        if (!item) return;
        let key;
        if (item.dataset.type === "private") {
            key = privateRoomName(CURRENT_USER, item.dataset.user);
        } else {
            key = item.dataset.room;
        }
        if (key === roomKey) {
            if (count > 0) {
                badge.textContent = count > 99 ? "99+" : count;
                badge.style.display = "inline-block";
            } else {
                badge.style.display = "none";
            }
        }
    });
}

function clearUnread(roomKey) {
    unreadCounts[roomKey] = 0;
    updateUnreadBadge(roomKey);
}

// ---------------------------------------------------------
// Rendering messages
// ---------------------------------------------------------
function renderMessage(msg) {
    const row = document.createElement("div");
    const isOwn = msg.sender === CURRENT_USER;
    row.className = "msg-row" + (isOwn ? " own" : "");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = (msg.sender[0] || "?").toUpperCase();

    const bubbleWrap = document.createElement("div");

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.innerHTML = `<span class="msg-sender">${escapeHtml(msg.sender)}</span>`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (msg.message_type === "image") {
        const img = document.createElement("img");
        img.src = msg.file_path;
        img.className = "msg-image";
        img.alt = msg.content || "image";
        img.onclick = () => window.open(msg.file_path, "_blank");
        bubble.appendChild(img);
        const caption = document.createElement("div");
        caption.style.marginTop = "4px";
        caption.style.fontSize = "12px";
        caption.textContent = msg.content || "";
        if (msg.content) bubble.appendChild(caption);
    } else if (msg.message_type === "file") {
        const link = document.createElement("a");
        link.href = msg.file_path;
        link.target = "_blank";
        link.className = "msg-file";
        link.innerHTML = `<span class="msg-file-icon">📄</span><span>${escapeHtml(msg.content || "File")}</span>`;
        bubble.appendChild(link);
    } else {
        const textSpan = document.createElement("span");
        textSpan.textContent = msg.content;
        bubble.appendChild(textSpan);
    }

    const time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = formatTime(msg.timestamp);
    bubble.appendChild(document.createElement("br"));
    bubble.appendChild(time);

    bubbleWrap.appendChild(meta);
    bubbleWrap.appendChild(bubble);

    row.appendChild(avatar);
    row.appendChild(bubbleWrap);
    messagesList.appendChild(row);
}

function renderSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system-msg";
    div.textContent = text;
    messagesList.appendChild(div);
}

// ---------------------------------------------------------
// Loading message history
// ---------------------------------------------------------
async function loadHistory(roomKey) {
    messagesList.innerHTML = "";
    try {
        const res = await fetch(`/api/messages/${roomKey}`);
        if (!res.ok) {
            renderSystemMessage("No previous messages.");
            return;
        }
        const messages = await res.json();
        if (messages.length === 0) {
            renderSystemMessage("No messages yet. Say hello! 👋");
        }
        messages.forEach(renderMessage);
        scrollToBottom();
    } catch (err) {
        console.error("Failed to load history", err);
    }
}

// ---------------------------------------------------------
// Room / DM switching
// ---------------------------------------------------------
function switchToRoom(roomName) {
    if (currentRoomType === "private") {
        socket.emit("leave", { room: privateRoomName(CURRENT_USER, currentTargetUser) });
    } else {
        socket.emit("leave", { room: currentRoom });
    }

    currentRoom = roomName;
    currentRoomType = "group";
    currentTargetUser = null;

    chatRoomName.textContent = roomName;
    chatSubtitle.textContent = "Public room";
    chatTitleIcon.textContent = "#";

    socket.emit("join", { room: roomName });
    loadHistory(roomName);
    clearUnread(roomName);
    highlightActiveItem();
}

function switchToPrivate(targetUser) {
    const roomKey = privateRoomName(CURRENT_USER, targetUser);

    if (currentRoomType === "private") {
        socket.emit("leave", { room: privateRoomName(CURRENT_USER, currentTargetUser) });
    } else {
        socket.emit("leave", { room: currentRoom });
    }

    currentRoomType = "private";
    currentTargetUser = targetUser;
    currentRoom = roomKey;

    chatRoomName.textContent = targetUser;
    chatSubtitle.textContent = "Private conversation";
    chatTitleIcon.textContent = targetUser[0].toUpperCase();

    socket.emit("join", { room: roomKey });
    loadHistory(roomKey);
    clearUnread(roomKey);
    highlightActiveItem();
}

function highlightActiveItem() {
    document.querySelectorAll(".room-item").forEach((item) => item.classList.remove("active"));
    if (currentRoomType === "group") {
        const el = document.querySelector(`.room-item[data-type="group"][data-room="${currentRoom}"]`);
        if (el) el.classList.add("active");
    } else {
        const el = document.querySelector(`.room-item[data-type="private"][data-user="${currentTargetUser}"]`);
        if (el) el.classList.add("active");
    }
}

// Bind click handlers (initial + dynamically added rooms)
function bindRoomClicks() {
    document.querySelectorAll(".room-item").forEach((item) => {
        item.onclick = () => {
            if (item.dataset.type === "private") {
                switchToPrivate(item.dataset.user);
            } else {
                switchToRoom(item.dataset.room);
            }
            // Close sidebar on mobile after selection
            sidebar.classList.remove("open");
        };
    });
}
bindRoomClicks();

// ---------------------------------------------------------
// Sending messages
// ---------------------------------------------------------
messageForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const content = messageInput.value.trim();
    if (!content) return;

    socket.emit("send_message", {
        room: getRoomKey(),
        content: content
    });

    messageInput.value = "";
    socket.emit("typing", { room: getRoomKey(), is_typing: false });
});

// ---------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------
messageInput.addEventListener("input", () => {
    socket.emit("typing", { room: getRoomKey(), is_typing: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit("typing", { room: getRoomKey(), is_typing: false });
    }, 1200);
});

socket.on("display_typing", (data) => {
    if (data.room !== getRoomKey()) return;
    if (data.is_typing) {
        typingIndicator.textContent = `${data.username} is typing...`;
        typingIndicator.style.display = "block";
    } else {
        typingIndicator.style.display = "none";
    }
});

// ---------------------------------------------------------
// Receiving messages
// ---------------------------------------------------------
socket.on("receive_message", (msg) => {
    const roomKey = msg.room;

    if (roomKey === getRoomKey()) {
        renderMessage(msg);
        scrollToBottom();
    }

    if (msg.sender !== CURRENT_USER) {
        notifyNewMessage(msg.sender, msg.content, roomKey);
    }
});

socket.on("status", (data) => {
    if (data.room === getRoomKey()) {
        renderSystemMessage(data.msg);
        scrollToBottom();
    }
});

// ---------------------------------------------------------
// Online users
// ---------------------------------------------------------
socket.on("update_online_users", (users) => {
    onlineUsersList = users;
    onlineCount.textContent = users.length;

    document.querySelectorAll("[data-user-dot]").forEach((dot) => {
        const username = dot.dataset.userDot;
        if (users.includes(username)) {
            dot.classList.remove("offline");
            dot.classList.add("online");
        } else {
            dot.classList.remove("online");
            dot.classList.add("offline");
        }
    });
});

// ---------------------------------------------------------
// Room creation
// ---------------------------------------------------------
addRoomBtn.addEventListener("click", () => {
    addRoomForm.style.display = addRoomForm.style.display === "none" ? "flex" : "none";
    newRoomNameInput.focus();
});

createRoomBtn.addEventListener("click", createRoom);
newRoomNameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") createRoom();
});

function createRoom() {
    const name = newRoomNameInput.value.trim();
    if (!name) return;
    socket.emit("create_room", { name });
    newRoomNameInput.value = "";
    addRoomForm.style.display = "none";
}

socket.on("room_created", (data) => {
    const roomList = document.getElementById("roomList");
    // Avoid duplicates
    if (document.querySelector(`.room-item[data-type="group"][data-room="${data.name}"]`)) return;

    const item = document.createElement("div");
    item.className = "room-item";
    item.dataset.room = data.name;
    item.dataset.type = "group";
    item.innerHTML = `
        <span class="room-icon">#</span>
        <span class="room-name">${escapeHtml(data.name)}</span>
        <span class="unread-badge" data-room-badge="${escapeHtml(data.name)}" style="display:none;">0</span>
    `;
    roomList.appendChild(item);
    bindRoomClicks();

    if (data.created_by !== CURRENT_USER) {
        showToast("New room", `#${data.name} was created by ${data.created_by}`);
    }
});

socket.on("room_error", (data) => {
    showToast("Error", data.error);
});

// ---------------------------------------------------------
// File upload (images & documents)
// ---------------------------------------------------------
attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    // 10MB limit check (matches server config)
    if (file.size > 10 * 1024 * 1024) {
        showToast("Upload error", "File is too large (max 10MB).");
        fileInput.value = "";
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("room", getRoomKey());

    uploadProgress.style.display = "block";
    uploadProgressBar.style.width = "0%";

    try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/upload");

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                uploadProgressBar.style.width = pct + "%";
            }
        };

        xhr.onload = () => {
            uploadProgress.style.display = "none";
            if (xhr.status !== 200) {
                const resp = JSON.parse(xhr.responseText || "{}");
                showToast("Upload failed", resp.error || "Could not upload file.");
            }
            // The actual message is broadcast via socket "receive_message"
        };

        xhr.onerror = () => {
            uploadProgress.style.display = "none";
            showToast("Upload failed", "Network error during upload.");
        };

        xhr.send(formData);
    } catch (err) {
        uploadProgress.style.display = "none";
        showToast("Upload failed", "Unexpected error.");
        console.error(err);
    }

    fileInput.value = "";
});

// ---------------------------------------------------------
// Emoji picker
// ---------------------------------------------------------
const EMOJIS = [
    "😀","😂","😍","🥰","😎","🤔","😢","😡","👍","👎",
    "🙏","👏","🎉","🔥","❤️","💯","😅","😭","🤣","😴",
    "🥳","😱","🤗","🙄","😏","👋","🤝","💪","✅","❌",
    "⭐","🚀","💡","📌","📎","🎂","☕","🍕","⚡","🌟"
];

function buildEmojiPicker() {
    emojiPicker.innerHTML = "";
    EMOJIS.forEach((emoji) => {
        const span = document.createElement("span");
        span.textContent = emoji;
        span.onclick = () => {
            messageInput.value += emoji;
            messageInput.focus();
        };
        emojiPicker.appendChild(span);
    });
}
buildEmojiPicker();

emojiBtn.addEventListener("click", () => {
    emojiPicker.style.display = emojiPicker.style.display === "none" ? "grid" : "none";
});

document.addEventListener("click", (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.style.display = "none";
    }
});

// ---------------------------------------------------------
// Sidebar toggle (mobile)
// ---------------------------------------------------------
openSidebarBtn.addEventListener("click", () => sidebar.classList.add("open"));
closeSidebarBtn.addEventListener("click", () => sidebar.classList.remove("open"));

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
socket.on("connect", () => {
    socket.emit("join", { room: currentRoom });
    loadHistory(currentRoom);
});
