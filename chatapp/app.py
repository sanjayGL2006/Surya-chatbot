"""
Real-Time Chat Application
Flask + Flask-SocketIO + SQLite

Run with: python app.py
"""

import os
import sqlite3
import re
from datetime import datetime
from functools import wraps

from flask import (
    Flask, render_template, request, redirect, url_for,
    session, jsonify, send_from_directory, flash
)
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "database", "chat.db")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp",      # images
    "pdf", "docx", "doc", "txt"               # documents
}
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB

app = Flask(__name__)
app.config["SECRET_KEY"] = "change-this-secret-key-in-production"
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

socketio = SocketIO(app, cors_allowed_origins="*")

os.makedirs(os.path.dirname(DATABASE), exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Track online users -> {username: sid}
online_users = {}


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def get_db():
    """Return a connection to the SQLite database with row factory set."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    # Enforce foreign keys & help avoid SQL injection issues by always
    # using parameterized queries (see usage below).
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Create tables and seed default/demo accounts if they do not exist."""
    conn = get_db()
    cur = conn.cursor()

    # USERS table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # CHAT ROOMS table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS chat_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            is_private INTEGER DEFAULT 0,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # MESSAGES table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room TEXT NOT NULL,
            sender TEXT NOT NULL,
            content TEXT,
            message_type TEXT DEFAULT 'text',  -- text | image | file
            file_path TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # UPLOADS table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uploader TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            file_type TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()

    # --- Seed default admin + demo accounts ---
    demo_accounts = [
        ("admin", "admin123", 1),
        ("user1", "user123", 0),
        ("user2", "user123", 0),
    ]
    for username, password, is_admin in demo_accounts:
        existing = cur.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not existing:
            cur.execute(
                "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
                (username, generate_password_hash(password), is_admin)
            )

    # --- Seed default chat rooms ---
    default_rooms = [("General", 0), ("Random", 0), ("Tech Talk", 0)]
    for name, is_private in default_rooms:
        existing = cur.execute(
            "SELECT id FROM chat_rooms WHERE name = ?", (name,)
        ).fetchone()
        if not existing:
            cur.execute(
                "INSERT INTO chat_rooms (name, is_private, created_by) VALUES (?, ?, ?)",
                (name, is_private, "admin")
            )

    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Utility / validation helpers
# ---------------------------------------------------------------------------
def allowed_file(filename):
    """Check file extension against the whitelist (secure upload handling)."""
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def is_valid_username(username):
    """Allow only alphanumeric, underscore, dash; 3-20 chars."""
    return bool(re.match(r"^[A-Za-z0-9_-]{3,20}$", username))


def is_valid_password(password):
    """Require at least 6 characters."""
    return isinstance(password, str) and len(password) >= 6


def login_required(f):
    """Decorator to protect routes that require an authenticated session."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


def get_private_room_name(user_a, user_b):
    """Deterministic private room name for two users (order independent)."""
    names = sorted([user_a, user_b])
    return f"private__{names[0]}__{names[1]}"


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    if "username" in session:
        return redirect(url_for("chat"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")

        # --- Input validation ---
        if not is_valid_username(username):
            flash("Username must be 3-20 characters (letters, numbers, _ or -).", "error")
            return render_template("register.html")

        if not is_valid_password(password):
            flash("Password must be at least 6 characters long.", "error")
            return render_template("register.html")

        if password != confirm:
            flash("Passwords do not match.", "error")
            return render_template("register.html")

        conn = get_db()
        cur = conn.cursor()

        # Parameterized query prevents SQL injection
        existing = cur.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()

        if existing:
            conn.close()
            flash("Username already taken. Please choose another.", "error")
            return render_template("register.html")

        password_hash = generate_password_hash(password)
        cur.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)",
            (username, password_hash)
        )
        conn.commit()
        conn.close()

        flash("Registration successful! Please log in.", "success")
        return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        conn = get_db()
        user = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        conn.close()

        # Verify hashed password
        if user and check_password_hash(user["password_hash"], password):
            session["username"] = user["username"]
            session["is_admin"] = bool(user["is_admin"])
            return redirect(url_for("chat"))

        flash("Invalid username or password.", "error")
        return render_template("login.html")

    return render_template("login.html")


@app.route("/logout")
def logout():
    username = session.get("username")
    session.clear()
    if username and username in online_users:
        del online_users[username]
    return redirect(url_for("login"))


# ---------------------------------------------------------------------------
# Main chat page
# ---------------------------------------------------------------------------
@app.route("/chat")
@login_required
def chat():
    conn = get_db()

    # All users (for private chat / sidebar)
    users = conn.execute(
        "SELECT username, is_admin FROM users ORDER BY username"
    ).fetchall()

    # All public rooms
    rooms = conn.execute(
        "SELECT * FROM chat_rooms WHERE is_private = 0 ORDER BY name"
    ).fetchall()

    conn.close()

    return render_template(
        "chat.html",
        username=session["username"],
        is_admin=session.get("is_admin", False),
        users=users,
        rooms=rooms
    )


# ---------------------------------------------------------------------------
# API: message history
# ---------------------------------------------------------------------------
@app.route("/api/messages/<room>")
@login_required
def get_messages(room):
    """Return message history for a room (public or private)."""
    # For private rooms, ensure the requesting user is part of the room name
    if room.startswith("private__"):
        parts = room.split("__")
        if len(parts) != 3 or session["username"] not in (parts[1], parts[2]):
            return jsonify({"error": "Unauthorized"}), 403

    conn = get_db()
    rows = conn.execute(
        "SELECT sender, content, message_type, file_path, timestamp "
        "FROM messages WHERE room = ? ORDER BY timestamp ASC LIMIT 100",
        (room,)
    ).fetchall()
    conn.close()

    messages = []
    for r in rows:
        messages.append({
            "sender": r["sender"],
            "content": r["content"],
            "message_type": r["message_type"],
            "file_path": r["file_path"],
            "timestamp": r["timestamp"]
        })
    return jsonify(messages)


# ---------------------------------------------------------------------------
# API: file upload (images & documents)
# ---------------------------------------------------------------------------
@app.route("/upload", methods=["POST"])
@login_required
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["file"]
    room = request.form.get("room", "General")

    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed"}), 400

    # Secure the filename and make it unique to avoid collisions/overwrites
    original_name = secure_filename(file.filename)
    ext = original_name.rsplit(".", 1)[1].lower()
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    stored_name = f"{session['username']}_{timestamp}.{ext}"

    filepath = os.path.join(app.config["UPLOAD_FOLDER"], stored_name)
    file.save(filepath)

    # Determine type for preview rendering
    image_exts = {"png", "jpg", "jpeg", "gif", "webp"}
    message_type = "image" if ext in image_exts else "file"

    file_url = url_for("static", filename=f"uploads/{stored_name}")

    # Save record in uploads table
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO uploads (uploader, original_name, stored_name, file_type) "
        "VALUES (?, ?, ?, ?)",
        (session["username"], original_name, stored_name, ext)
    )

    # Save as a chat message too
    cur.execute(
        "INSERT INTO messages (room, sender, content, message_type, file_path) "
        "VALUES (?, ?, ?, ?, ?)",
        (room, session["username"], original_name, message_type, file_url)
    )
    conn.commit()
    conn.close()

    # Broadcast the new message to the room via SocketIO
    socketio.emit("receive_message", {
        "sender": session["username"],
        "content": original_name,
        "message_type": message_type,
        "file_path": file_url,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "room": room
    }, room=room)

    return jsonify({
        "success": True,
        "file_path": file_url,
        "message_type": message_type,
        "original_name": original_name
    })


# ---------------------------------------------------------------------------
# Socket.IO event handlers
# ---------------------------------------------------------------------------
@socketio.on("connect")
def handle_connect():
    username = session.get("username")
    if username:
        online_users[username] = request.sid
        emit("update_online_users", list(online_users.keys()), broadcast=True)


@socketio.on("disconnect")
def handle_disconnect():
    username = session.get("username")
    if username and username in online_users:
        del online_users[username]
        emit("update_online_users", list(online_users.keys()), broadcast=True)


@socketio.on("join")
def handle_join(data):
    """User joins a room (public or private)."""
    room = data.get("room")
    username = session.get("username")
    if not room or not username:
        return
    join_room(room)
    emit("status", {
        "msg": f"{username} has joined the room.",
        "room": room
    }, room=room)


@socketio.on("leave")
def handle_leave(data):
    room = data.get("room")
    username = session.get("username")
    if not room or not username:
        return
    leave_room(room)
    emit("status", {
        "msg": f"{username} has left the room.",
        "room": room
    }, room=room)


@socketio.on("send_message")
def handle_send_message(data):
    """Receive a chat message, persist it, and broadcast to the room."""
    username = session.get("username")
    room = data.get("room")
    content = (data.get("content") or "").strip()

    if not username or not room or not content:
        return

    # Basic sanitization / length limit
    content = content[:2000]

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO messages (room, sender, content, message_type) "
        "VALUES (?, ?, ?, 'text')",
        (room, username, content)
    )
    conn.commit()
    conn.close()

    emit("receive_message", {
        "sender": username,
        "content": content,
        "message_type": "text",
        "file_path": None,
        "timestamp": timestamp,
        "room": room
    }, room=room)


@socketio.on("typing")
def handle_typing(data):
    """Broadcast typing indicator to other users in the room."""
    username = session.get("username")
    room = data.get("room")
    is_typing = data.get("is_typing", False)
    if not username or not room:
        return
    emit("display_typing", {
        "username": username,
        "room": room,
        "is_typing": is_typing
    }, room=room, include_self=False)


@socketio.on("create_room")
def handle_create_room(data):
    """Create a new public chat room and notify everyone."""
    room_name = (data.get("name") or "").strip()
    username = session.get("username")
    if not room_name or not username:
        return

    if not re.match(r"^[A-Za-z0-9 _-]{2,30}$", room_name):
        emit("room_error", {"error": "Invalid room name."})
        return

    conn = get_db()
    cur = conn.cursor()
    existing = cur.execute(
        "SELECT id FROM chat_rooms WHERE name = ?", (room_name,)
    ).fetchone()
    if existing:
        conn.close()
        emit("room_error", {"error": "Room already exists."})
        return

    cur.execute(
        "INSERT INTO chat_rooms (name, is_private, created_by) VALUES (?, ?, ?)",
        (room_name, 0, username)
    )
    conn.commit()
    conn.close()

    emit("room_created", {"name": room_name, "created_by": username}, broadcast=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    init_db()
    print("=" * 60)
    print(" Real-Time Chat Application")
    print(" Default admin login -> username: admin | password: admin123")
    print(" Demo users -> user1/user123, user2/user123")
    print(" Server running at: http://127.0.0.1:5000")
    print("=" * 60)
    socketio.run(app, debug=True, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)
