#Surya chatbot — Real-Time Chat Application

A modern, full-featured real-time chat app built with **Flask + Flask-SocketIO + SQLite**.

---

## Features
- 🔐 Secure auth (password hashing, sessions)
- 💬 Real-time messaging via WebSockets
- 🏠 Public rooms + private DMs
- ⌨️ Typing indicators
- 📁 Image & document uploads (preview in chat)
- 😊 Emoji picker
- 🌙 Dark / Light mode toggle
- 🔔 Browser notifications + unread counters
- 📱 Mobile-responsive layout

---

## Demo Accounts
| Username | Password  |
|----------|-----------|
| admin    | admin123  |
| user1    | user123   |
| user2    | user123   |

---

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the app
python app.py

# 3. Open your browser
http://127.0.0.1:5000
```

---

## Project Structure
```
chatapp/
├── app.py                  # Flask app + SocketIO + routes
├── requirements.txt
├── README.md
├── database/
│   └── chat.db             # SQLite (auto-created on first run)
├── static/
│   ├── css/style.css       # All styles, dark/light theme
│   ├── js/
│   │   ├── chat.js         # SocketIO client, UI logic
│   │   └── theme.js        # Dark/light toggle
│   └── uploads/            # Uploaded files (auto-created)
└── templates/
    ├── base.html
    ├── login.html
    ├── register.html
    └── chat.html
```

---

## Security Notes
- Passwords hashed with **Werkzeug** (PBKDF2-SHA256)
- All DB queries use **parameterized statements** (no SQL injection)
- File uploads: extension whitelist + `secure_filename` + unique names
- Input validated on both client and server side
- Session-based authentication on every protected route

---

## Database Schema
```sql
users       (id, username, password_hash, is_admin, created_at)
chat_rooms  (id, name, is_private, created_by, created_at)
messages    (id, room, sender, content, message_type, file_path, timestamp)
uploads     (id, uploader, original_name, stored_name, file_type, uploaded_at)
```
