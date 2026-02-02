let backendConfig = {
    url: '',
    botToken: '',
    channelUsername: ''
};

// Load saved configuration
window.addEventListener('DOMContentLoaded', () => {
    loadBackendConfig();
});

window.generateBackendCode = function() {
    const botToken = document.getElementById('bot-token').value.trim();
    const channelUsername = document.getElementById('channel-username').value.trim();
    const port = document.getElementById('port').value || '5000';
    
    if (!botToken || !channelUsername) {
        alert('Please enter both Bot Token and Channel Username');
        return;
    }
    
    const code = `from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from telegram import Bot
import asyncio
import json
import os
from datetime import datetime
from io import BytesIO

app = Flask(__name__)
CORS(app)

# Configuration
BOT_TOKEN = "${botToken}"
CHANNEL_USERNAME = "${channelUsername}"
DATABASE_FILE = "file_database.json"

bot = Bot(token=BOT_TOKEN)

# Helper function to run async code properly
def run_async(coro):
    """Run async code in a way that handles event loop issues"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("Loop is closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)

# Initialize database
if not os.path.exists(DATABASE_FILE):
    with open(DATABASE_FILE, 'w') as f:
        json.dump({}, f)

def load_database():
    with open(DATABASE_FILE, 'r') as f:
        return json.load(f)

def save_database(data):
    with open(DATABASE_FILE, 'w') as f:
        json.dump(data, f, indent=2)

@app.route('/')
def index():
    """Serve the main HTML page"""
    return send_from_directory('.', 'index.html')

@app.route('/style.css')
def serve_css():
    """Serve CSS file"""
    return send_from_directory('.', 'style.css')

@app.route('/app.js')
def serve_js():
    """Serve JavaScript file"""
    return send_from_directory('.', 'app.js')

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file content into memory
        file_content = file.read()
        file.seek(0)
        
        # Run async Telegram operation
        async def send_to_telegram():
            message = await bot.send_document(
                chat_id=CHANNEL_USERNAME,
                document=BytesIO(file_content),
                filename=file.filename,
                caption=f"File: {file.filename}\\nUploaded: {datetime.now().isoformat()}"
            )
            return message.document.file_id
        
        file_id = run_async(send_to_telegram())
        
        # Save to database
        db = load_database()
        db[file.filename] = {
            'file_id': file_id,
            'uploaded_at': datetime.now().isoformat(),
            'size': request.content_length
        }
        save_database(db)
        
        return jsonify({
            'success': True,
            'filename': file.filename,
            'file_id': file_id,
            'message': 'File uploaded successfully'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    try:
        db = load_database()
        
        if filename not in db:
            return jsonify({'error': 'File not found'}), 404
        
        file_data = db[filename]
        
        return jsonify({
            'success': True,
            'filename': filename,
            'file_id': file_data['file_id'],
            'uploaded_at': file_data.get('uploaded_at'),
            'size': file_data.get('size')
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/files', methods=['GET'])
def list_files():
    try:
        db = load_database()
        return jsonify({
            'success': True,
            'files': db,
            'count': len(db)
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download/file/<identifier>', methods=['GET'])
def download_file_content(identifier):
    try:
        db = load_database()
        file_id = None
        filename = None
        
        # Check if identifier is a filename in database
        if identifier in db:
            filename = identifier
            file_id = db[identifier]['file_id']
        else:
            # Search for file_id in database
            for fname, fdata in db.items():
                if fdata['file_id'] == identifier:
                    filename = fname
                    file_id = identifier
                    break
        
        if not file_id:
            return jsonify({'error': 'File not found'}), 404
        
        # Download file from Telegram
        async def get_file_from_telegram():
            file = await bot.get_file(file_id)
            file_bytes = BytesIO()
            await file.download_to_memory(file_bytes)
            file_bytes.seek(0)
            return file_bytes.read()
        
        file_content = run_async(get_file_from_telegram())
        
        # Send file to user
        from flask import send_file
        return send_file(
            BytesIO(file_content),
            as_attachment=True,
            download_name=filename,
            mimetype='application/octet-stream'
        )
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/scan-channel', methods=['POST'])
def scan_channel():
    try:
        async def scan_telegram_channel():
            updates = await bot.get_updates(limit=100)
            files_added = []
            
            try:
                from telegram import ChatAction
                chat_id = CHANNEL_USERNAME
                
                offset = 0
                messages = []
                async for message in bot.get_chat_history(chat_id, limit=100):
                    messages.append(message)
            except:
                messages = []
                for update in updates:
                    if update.message:
                        messages.append(update.message)
            
            db = load_database()
            
            for message in messages:
                if hasattr(message, 'document') and message.document:
                    file_id = message.document.file_id
                    filename = message.document.file_name or f"file_{file_id[:8]}"
                    
                    found = False
                    for fname, fdata in db.items():
                        if fdata.get('file_id') == file_id:
                            found = True
                            break
                    
                    if not found:
                        db[filename] = {
                            'file_id': file_id,
                            'uploaded_at': message.date.isoformat() if message.date else datetime.now().isoformat(),
                            'size': message.document.file_size
                        }
                        files_added.append(filename)
            
            save_database(db)
            return files_added
        
        files_added = run_async(scan_telegram_channel())
        
        return jsonify({
            'success': True,
            'files_added': files_added,
            'count': len(files_added)
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    try:
        async def get_bot_info():
            me = await bot.get_me()
            return me.username
        
        bot_username = run_async(get_bot_info())
        db = load_database()
        
        return jsonify({
            'success': True,
            'bot_username': bot_username,
            'channel': CHANNEL_USERNAME,
            'total_files': len(db)
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=${port}, debug=True)`;
    
    document.getElementById('backend-code').textContent = code;
    document.getElementById('generated-code').style.display = 'block';
    document.getElementById('generated-code').scrollIntoView({ behavior: 'smooth' });
};

window.copyCode = function() {
    const code = document.getElementById('backend-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const copyBtn = document.querySelectorAll('.copy-btn')[1];
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    });
};

window.downloadAllFiles = function() {
    const botToken = document.getElementById('bot-token').value.trim();
    const channelUsername = document.getElementById('channel-username').value.trim();
    const port = document.getElementById('port').value || '5000';
    
    if (!botToken || !channelUsername) {
        alert('Please enter both Bot Token and Channel Username first');
        return;
    }
    
    // Get backend code
    const backendCode = document.getElementById('backend-code').textContent;
    
    // Create standalone HTML
    const standaloneHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telegram Cloud Storage</title>
    <link rel="stylesheet" href="style.css">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>
    <div class="container">
        <header>
            <h1>Telegram Cloud Storage</h1>
            <p class="subtitle">Unlimited file storage using Telegram</p>
        </header>

        <nav class="tabs">
            <button class="tab-btn active" data-tab="dashboard">Dashboard</button>
            <button class="tab-btn" data-tab="upload">Upload</button>
            <button class="tab-btn" data-tab="download">Download</button>
            <button class="tab-btn" data-tab="settings">Settings</button>
        </nav>

        <!-- Dashboard Section -->
        <section id="dashboard" class="tab-content active">
            <div class="status-card">
                <h2>Storage Status</h2>
                <div class="stats">
                    <div class="stat-item">
                        <span class="stat-label">Total Files</span>
                        <span class="stat-value" id="total-files">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Backend Status</span>
                        <span class="stat-value" id="backend-status">Not Connected</span>
                    </div>
                </div>
            </div>

            <div class="quick-actions">
                <button class="action-btn" onclick="switchTab('upload')">
                    <span class="btn-icon">📤</span>
                    Upload File
                </button>
                <button class="action-btn" onclick="switchTab('download')">
                    <span class="btn-icon">📥</span>
                    Download File
                </button>
                <button class="action-btn" onclick="viewFileIds()">
                    <span class="btn-icon">📋</span>
                    View File IDs
                </button>
            </div>

            <div id="file-list" class="file-list"></div>
        </section>

        <!-- Upload Section -->
        <section id="upload" class="tab-content">
            <h2>Upload Files</h2>
            <p class="info-text">Upload files to your Telegram cloud storage (max 100 files at once)</p>

            <div class="upload-area">
                <input type="file" id="file-input" style="display: none;" multiple onchange="handleFileSelect()">
                <div class="upload-box" onclick="document.getElementById('file-input').click()">
                    <span class="upload-icon">📁</span>
                    <p>Click to select files</p>
                    <small id="selected-file">No files selected</small>
                </div>
            </div>

            <div id="selected-files-list" style="display: none; margin-bottom: 1rem;"></div>

            <button class="primary-btn" id="upload-btn" onclick="uploadFiles()" disabled>Upload</button>

            <div id="upload-progress" class="progress-container" style="display: none;"></div>

            <div id="upload-result" class="result-box" style="display: none;"></div>
        </section>

        <!-- Download Section -->
        <section id="download" class="tab-content">
            <h2>Download File</h2>
            <p class="info-text">Retrieve files from your Telegram cloud storage</p>

            <div class="form-group">
                <label for="filename-input">Filename or File ID</label>
                <input type="text" id="filename-input" placeholder="example.pdf or file ID">
                <small>Enter either the filename or the file ID from Telegram</small>
            </div>

            <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
                <button class="secondary-btn" onclick="getFileInfo()" style="flex: 1;">Get File Info</button>
                <button class="primary-btn" onclick="downloadFile()" style="flex: 1;">Download File</button>
            </div>

            <div style="padding: 1rem; background: #f8f8f8; border-radius: 4px; margin-bottom: 1rem;">
                <h3 style="font-size: 1rem; margin-bottom: 0.5rem;">Channel Sync</h3>
                <p style="font-size: 0.85rem; color: #666; margin-bottom: 0.75rem;">Scan your Telegram channel for files not in the database (last 10 days)</p>
                <button class="secondary-btn" onclick="scanChannel()" style="margin: 0;">Scan Channel</button>
            </div>

            <div style="padding: 1rem; background: #f8f8f8; border-radius: 4px; margin-bottom: 1rem;">
                <h3 style="font-size: 1rem; margin-bottom: 0.5rem;">Search Telegram Directly</h3>
                <p style="font-size: 0.85rem; color: #666; margin-bottom: 0.75rem;">Search for files directly in your Telegram channel (last 10 days)</p>
                <div style="display: flex; gap: 0.5rem;">
                    <input type="text" id="telegram-search-input" placeholder="Search filename..." style="flex: 1; padding: 0.5rem; border: 1px solid #e0e0e0; border-radius: 4px;">
                    <button class="secondary-btn" onclick="searchTelegram()" style="margin: 0;">Search Telegram</button>
                </div>
            </div>

            <div id="download-result" class="result-box" style="display: none;"></div>
        </section>

        <!-- Settings Section -->
        <section id="settings" class="tab-content">
            <h2>Backend Configuration</h2>
            <p class="info-text">Configure your backend server connection</p>

            <div class="form-group">
                <label for="backend-url">Backend URL</label>
                <div style="display: flex; gap: 0.5rem;">
                    <input type="text" id="backend-url" placeholder="http://localhost:5000" style="flex: 1;">
                    <button class="test-btn" onclick="testBackendUrl()">Test</button>
                </div>
                <small>If running locally: http://localhost:5000 or http://127.0.0.1:5000</small>
                <div id="url-test-result" class="test-result"></div>
            </div>

            <button class="secondary-btn" onclick="saveBackendConfig()">Save Configuration</button>
        </section>
    </div>

    <script src="app.js"></script>
</body>
</html>`;

    // Create standalone CSS (copy from current page)
    const standaloneCSS = `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Noto Sans', sans-serif;
    background: #fff;
    color: #1a1a1a;
    line-height: 1.6;
}

.container {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1rem;
}

header {
    text-align: center;
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid #e0e0e0;
}

h1 {
    font-size: 2rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
}

.subtitle {
    color: #666;
    font-size: 0.95rem;
}

.tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 2rem;
    border-bottom: 1px solid #e0e0e0;
    overflow-x: auto;
}

.tab-btn {
    background: none;
    border: none;
    padding: 0.75rem 1.25rem;
    cursor: pointer;
    font-size: 0.95rem;
    color: #666;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
    white-space: nowrap;
}

.tab-btn:hover {
    color: #1a1a1a;
}

.tab-btn.active {
    color: #1a1a1a;
    border-bottom-color: #1a1a1a;
    font-weight: 500;
}

.tab-content {
    display: none;
    animation: fadeIn 0.3s;
}

.tab-content.active {
    display: block;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

.status-card {
    background: #f8f8f8;
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 2rem;
}

.status-card h2 {
    font-size: 1.25rem;
    margin-bottom: 1rem;
}

.stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
}

.stat-item {
    display: flex;
    flex-direction: column;
}

.stat-label {
    font-size: 0.85rem;
    color: #666;
    margin-bottom: 0.25rem;
}

.stat-value {
    font-size: 1.5rem;
    font-weight: 600;
}

.quick-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}

.action-btn {
    background: #f8f8f8;
    border: 1px solid #e0e0e0;
    padding: 1.25rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
}

.action-btn:hover {
    background: #fff;
    border-color: #1a1a1a;
}

.btn-icon {
    font-size: 1.5rem;
}

.form-group {
    margin-bottom: 1.5rem;
}

label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    font-size: 0.95rem;
}

input[type="text"],
input[type="number"] {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    font-size: 0.95rem;
    font-family: inherit;
}

input:focus {
    outline: none;
    border-color: #1a1a1a;
}

small {
    display: block;
    margin-top: 0.25rem;
    color: #666;
    font-size: 0.85rem;
}

.info-text {
    color: #666;
    margin-bottom: 1.5rem;
}

.primary-btn,
.secondary-btn,
.test-btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 4px;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.primary-btn {
    background: #1a1a1a;
    color: white;
}

.primary-btn:hover:not(:disabled) {
    background: #000;
}

.primary-btn:disabled {
    background: #ccc;
    cursor: not-allowed;
}

.secondary-btn {
    background: #f8f8f8;
    color: #1a1a1a;
    border: 1px solid #e0e0e0;
    margin-top: 1rem;
}

.secondary-btn:hover {
    background: #fff;
    border-color: #1a1a1a;
}

.test-btn {
    background: #f8f8f8;
    color: #1a1a1a;
    border: 1px solid #e0e0e0;
    white-space: nowrap;
}

.test-btn:hover {
    background: #fff;
    border-color: #1a1a1a;
}

.upload-area {
    margin-bottom: 1.5rem;
}

.upload-box {
    border: 2px dashed #e0e0e0;
    border-radius: 8px;
    padding: 3rem 2rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
}

.upload-box:hover {
    border-color: #1a1a1a;
    background: #fafafa;
}

.upload-icon {
    font-size: 3rem;
    display: block;
    margin-bottom: 1rem;
}

.upload-box p {
    margin-bottom: 0.5rem;
}

.progress-container {
    margin-top: 1.5rem;
}

.progress-bar {
    width: 100%;
    height: 8px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
}

.progress-fill {
    height: 100%;
    background: #1a1a1a;
    width: 0%;
    transition: width 0.3s;
}

.progress-text {
    text-align: center;
    color: #666;
    font-size: 0.9rem;
}

.result-box {
    margin-top: 1.5rem;
    padding: 1rem;
    border-radius: 4px;
    border: 1px solid #e0e0e0;
    background: #f8f8f8;
}

.result-box.success {
    border-color: #4caf50;
    background: #f1f8f4;
}

.result-box.error {
    border-color: #f44336;
    background: #fef1f0;
}

.file-list {
    margin-top: 2rem;
}

.file-item {
    padding: 1rem;
    background: #f8f8f8;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.file-info {
    flex: 1;
}

.file-name {
    font-weight: 500;
    margin-bottom: 0.25rem;
}

.file-id {
    font-size: 0.85rem;
    color: #666;
}

.test-result {
    margin-top: 0.5rem;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
    display: none;
}

.test-result.success {
    background: #f1f8f4;
    color: #2e7d32;
    border: 1px solid #4caf50;
    display: block;
}

.test-result.error {
    background: #fef1f0;
    color: #c62828;
    border: 1px solid #f44336;
    display: block;
}

.test-result.testing {
    background: #fff8e1;
    color: #f57c00;
    border: 1px solid #ffb300;
    display: block;
}

@media (max-width: 768px) {
    .container {
        padding: 1rem 0.5rem;
    }
    h1 {
        font-size: 1.5rem;
    }
    .tabs {
        gap: 0.25rem;
    }
    .tab-btn {
        padding: 0.6rem 0.8rem;
        font-size: 0.85rem;
    }
    .stats {
        grid-template-columns: 1fr;
    }
    .quick-actions {
        grid-template-columns: 1fr;
    }
}`;

    // Create standalone JS
    const standaloneJS = `let selectedFiles = [];
let backendConfig = { url: '' };

window.addEventListener('DOMContentLoaded', () => {
    loadBackendConfig();
    checkBackendStatus();
    loadFileList();
});

window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.querySelector(\`[data-tab="\${tabName}"]\`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
};

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        switchTab(tabName);
    });
});

window.saveBackendConfig = function() {
    const url = document.getElementById('backend-url').value.trim();
    
    if (!url) {
        alert('Please enter a backend URL');
        return;
    }
    
    localStorage.setItem('backendConfig', JSON.stringify({ url }));
    backendConfig = { url };
    
    alert('Configuration saved!');
    checkBackendStatus();
};

function loadBackendConfig() {
    const saved = localStorage.getItem('backendConfig');
    if (saved) {
        backendConfig = JSON.parse(saved);
        document.getElementById('backend-url').value = backendConfig.url || '';
    }
}

async function checkBackendStatus() {
    if (!backendConfig.url) {
        document.getElementById('backend-status').textContent = 'Not Configured';
        return;
    }
    
    try {
        const response = await fetch(\`\${backendConfig.url}/status\`);
        if (response.ok) {
            const data = await response.json();
            document.getElementById('backend-status').textContent = 'Connected';
            document.getElementById('total-files').textContent = data.total_files || 0;
        } else {
            document.getElementById('backend-status').textContent = 'Offline';
        }
    } catch (error) {
        document.getElementById('backend-status').textContent = 'Offline';
    }
}

window.handleFileSelect = function() {
    const input = document.getElementById('file-input');
    if (input.files && input.files.length > 0) {
        selectedFiles = Array.from(input.files).slice(0, 100);
        
        const fileListDiv = document.getElementById('selected-files-list');
        const selectedFileText = document.getElementById('selected-file');
        
        if (selectedFiles.length > 0) {
            selectedFileText.textContent = \`\${selectedFiles.length} file(s) selected\`;
            document.getElementById('upload-btn').disabled = false;
            
            fileListDiv.style.display = 'block';
            fileListDiv.innerHTML = '<h4 style="margin-bottom: 0.5rem;">Selected Files:</h4>';
            
            const listContainer = document.createElement('div');
            listContainer.style.cssText = 'max-height: 200px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 4px; padding: 0.5rem;';
            
            selectedFiles.forEach((file, index) => {
                const fileItem = document.createElement('div');
                fileItem.style.cssText = 'padding: 0.25rem 0; font-size: 0.9rem; display: flex; justify-content: space-between;';
                fileItem.innerHTML = \`
                    <span>\${index + 1}. \${file.name}</span>
                    <span style="color: #666;">\${(file.size / 1024 / 1024).toFixed(2)} MB</span>
                \`;
                listContainer.appendChild(fileItem);
            });
            
            fileListDiv.appendChild(listContainer);
        } else {
            selectedFileText.textContent = 'No files selected';
            document.getElementById('upload-btn').disabled = true;
            fileListDiv.style.display = 'none';
        }
    }
};

window.uploadFiles = async function() {
    if (selectedFiles.length === 0) {
        alert('Please select files first');
        return;
    }
    
    if (!backendConfig.url) {
        alert('Please configure your backend URL in Settings');
        return;
    }
    
    const progressContainer = document.getElementById('upload-progress');
    const resultBox = document.getElementById('upload-result');
    const uploadBtn = document.getElementById('upload-btn');
    
    progressContainer.style.display = 'block';
    progressContainer.innerHTML = '';
    resultBox.style.display = 'none';
    uploadBtn.disabled = true;
    
    const results = { success: [], failed: [] };
    
    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        
        const fileProgressDiv = document.createElement('div');
        fileProgressDiv.style.cssText = 'margin-bottom: 1rem; padding: 0.75rem; background: #f8f8f8; border-radius: 4px;';
        fileProgressDiv.innerHTML = \`
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <strong>\${file.name}</strong>
                <span id="status-\${i}">Uploading...</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" id="progress-\${i}"></div>
            </div>
        \`;
        progressContainer.appendChild(fileProgressDiv);
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch(\`\${backendConfig.url}/upload\`, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || \`Server error: \${response.status}\`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                document.getElementById(\`status-\${i}\`).textContent = '✓ Done';
                document.getElementById(\`status-\${i}\`).style.color = '#4caf50';
                document.getElementById(\`progress-\${i}\`).style.width = '100%';
                results.success.push(file.name);
            } else {
                throw new Error(data.error || 'Upload failed');
            }
        } catch (error) {
            document.getElementById(\`status-\${i}\`).textContent = '✗ Failed';
            document.getElementById(\`status-\${i}\`).style.color = '#f44336';
            document.getElementById(\`progress-\${i}\`).style.width = '100%';
            document.getElementById(\`progress-\${i}\`).style.background = '#f44336';
            results.failed.push({ name: file.name, error: error.message });
        }
    }
    
    // Show summary
    resultBox.style.display = 'block';
    resultBox.className = results.failed.length === 0 ? 'result-box success' : 'result-box';
    
    let summaryHTML = \`<h3>Upload Complete</h3>\`;
    
    if (results.success.length > 0) {
        summaryHTML += \`<p style="color: #4caf50;"><strong>✓ Successfully uploaded:</strong> \${results.success.length} file(s)</p>\`;
    }
    
    if (results.failed.length > 0) {
        summaryHTML += \`<p style="color: #f44336; margin-top: 0.5rem;"><strong>✗ Failed:</strong> \${results.failed.length} file(s)</p>\`;
        summaryHTML += '<div style="margin-top: 0.5rem; max-height: 100px; overflow-y: auto; font-size: 0.85rem;">';
        results.failed.forEach(f => {
            summaryHTML += \`<div>\${f.name}: \${f.error}</div>\`;
        });
        summaryHTML += '</div>';
    }
    
    resultBox.innerHTML = summaryHTML;
    
    // Reset
    selectedFiles = [];
    document.getElementById('file-input').value = '';
    document.getElementById('selected-file').textContent = 'No files selected';
    document.getElementById('selected-files-list').style.display = 'none';
    uploadBtn.disabled = true;
    
    loadFileList();
    checkBackendStatus();
};

window.downloadFile = async function() {
    const identifier = document.getElementById('filename-input').value.trim();
    
    if (!identifier) {
        alert('Please enter a filename or file ID');
        return;
    }
    
    if (!backendConfig.url) {
        alert('Please configure your backend URL in Settings');
        return;
    }
    
    const resultBox = document.getElementById('download-result');
    resultBox.style.display = 'block';
    resultBox.className = 'result-box';
    resultBox.innerHTML = '<p>Retrieving file from Telegram bot...</p>';
    
    try {
        // Download the file from Telegram via backend
        const downloadUrl = \`\${backendConfig.url}/download/file/\${encodeURIComponent(identifier)}\`;
        const downloadResponse = await fetch(downloadUrl);
        
        if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'File not found');
        }
        
        // Get filename from Content-Disposition header if available
        const contentDisposition = downloadResponse.headers.get('Content-Disposition');
        let filename = identifier;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
            if (filenameMatch) filename = filenameMatch[1];
        }
        
        // Create blob and trigger download
        const blob = await downloadResponse.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        resultBox.className = 'result-box success';
        resultBox.innerHTML = \`
            <h3>✓ Download Complete</h3>
            <p><strong>Filename:</strong> \${filename}</p>
            <p style="font-size: 0.9rem; color: #666; margin-top: 0.5rem;">
                File retrieved from Telegram bot and downloaded to your device
            </p>
        \`;
    } catch (error) {
        resultBox.className = 'result-box error';
        resultBox.innerHTML = \`
            <h3>✗ Download Failed</h3>
            <p>\${error.message}</p>
            <p style="font-size: 0.9rem; color: #666; margin-top: 0.5rem;">
                Make sure the file exists and your backend is running
            </p>
        \`;
    }
};

window.viewFileIds = async function() {
    await loadFileList();
    switchTab('dashboard');
    document.getElementById('file-list').scrollIntoView({ behavior: 'smooth' });
};

let allFiles = {};

async function loadFileList(searchQuery = '') {
    if (!backendConfig.url) {
        return;
    }
    
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '<h3>Loading files...</h3>';
    
    try {
        const response = await fetch(\`\${backendConfig.url}/files\`);
        const data = await response.json();
        
        if (data.success) {
            allFiles = data.files;
            const fileEntries = Object.entries(allFiles);
            
            if (fileEntries.length === 0) {
                fileList.innerHTML = '<p style="text-align: center; color: #666;">No files uploaded yet</p>';
                return;
            }
            
            const filteredEntries = searchQuery 
                ? fileEntries.filter(([filename]) => filename.toLowerCase().includes(searchQuery.toLowerCase()))
                : fileEntries;
            
            fileList.innerHTML = \`
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3>Your Files</h3>
                    <div style="display: flex; gap: 0.5rem;">
                        <input type="text" id="file-search" placeholder="Search files..." style="padding: 0.5rem; border: 1px solid #e0e0e0; border-radius: 4px;" value="\${searchQuery}">
                        <button class="secondary-btn" onclick="searchFiles()" style="margin: 0; padding: 0.5rem 1rem;">Search</button>
                    </div>
                </div>
            \`;
            
            if (filteredEntries.length === 0) {
                const noResults = document.createElement('p');
                noResults.style.textAlign = 'center';
                noResults.style.color = '#666';
                noResults.textContent = 'No files found matching your search';
                fileList.appendChild(noResults);
                return;
            }
            
            filteredEntries.forEach(([filename, fileData]) => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.innerHTML = \`
                    <div class="file-info">
                        <div class="file-name">\${filename}</div>
                        <div class="file-id">ID: \${fileData.file_id}</div>
                    </div>
                    <button class="secondary-btn" onclick="downloadFileByName('\${filename.replace(/'/g, "\\\\'")}')">Download</button>
                \`;
                fileList.appendChild(fileItem);
            });
            
            document.getElementById('file-search').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') searchFiles();
            });
        }
    } catch (error) {
        fileList.innerHTML = '<p style="text-align: center; color: #666;">Unable to load files. Is your backend running?</p>';
    }
}

window.searchFiles = function() {
    const searchQuery = document.getElementById('file-search').value.trim();
    loadFileList(searchQuery);
};

window.downloadFileByName = async function(filename) {
    const resultBox = document.getElementById('download-result');
    resultBox.style.display = 'block';
    resultBox.className = 'result-box';
    resultBox.innerHTML = '<p>Retrieving file from Telegram bot...</p>';
    
    switchTab('download');
    document.getElementById('filename-input').value = filename;
    
    try {
        const downloadUrl = \`\${backendConfig.url}/download/file/\${encodeURIComponent(filename)}\`;
        const downloadResponse = await fetch(downloadUrl);
        
        if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'File not found');
        }
        
        const contentDisposition = downloadResponse.headers.get('Content-Disposition');
        let downloadName = filename;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
            if (filenameMatch) downloadName = filenameMatch[1];
        }
        
        const blob = await downloadResponse.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        resultBox.className = 'result-box success';
        resultBox.innerHTML = \`
            <h3>✓ Download Complete</h3>
            <p><strong>Filename:</strong> \${downloadName}</p>
            <p style="font-size: 0.9rem; color: #666; margin-top: 0.5rem;">
                File retrieved from Telegram bot and downloaded to your device
            </p>
        \`;
    } catch (error) {
        resultBox.className = 'result-box error';
        resultBox.innerHTML = \`
            <h3>✗ Download Failed</h3>
            <p>\${error.message}</p>
            <p style="font-size: 0.9rem; color: #666; margin-top: 0.5rem;">
                Make sure the file exists and your backend is running
            </p>
        \`;
    }
}

window.scanChannel = async function() {
    if (!backendConfig.url) {
        alert('Please configure your backend URL first');
        return;
    }
    
    const resultBox = document.getElementById('download-result');
    resultBox.style.display = 'block';
    resultBox.className = 'result-box';
    resultBox.innerHTML = '<p>Scanning channel for missing files (last 10 days)...</p>';
    
    try {
        const response = await fetch(\`\${backendConfig.url}/scan-channel\`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Scan failed');
        }
        
        const data = await response.json();
        
        resultBox.className = 'result-box success';
        resultBox.innerHTML = \`
            <h3>✓ Channel Scan Complete</h3>
            <p><strong>Files added to database:</strong> \${data.count}</p>
            \${data.files_added && data.files_added.length > 0 ? \`
                <details style="margin-top: 0.5rem;">
                    <summary style="cursor: pointer;">View added files</summary>
                    <div style="margin-top: 0.5rem; max-height: 150px; overflow-y: auto; font-size: 0.85rem;">
                        \${data.files_added.map(f => \`<div>• \${f}</div>\`).join('')}
                    </div>
                </details>
            \` : '<p style="margin-top: 0.5rem; color: #666; font-size: 0.9rem;">No new files found in the last 10 days</p>'}
        \`;
        
        loadFileList();
        checkBackendStatus();
    } catch (error) {
        resultBox.className = 'result-box error';
        resultBox.innerHTML = \`
            <h3>✗ Scan Failed</h3>
            <p>\${error.message}</p>
        \`;
    }
};

window.searchTelegram = async function() {
    if (!backendConfig.url) {
        alert('Please configure your backend URL first');
        return;
    }
    
    const searchQuery = document.getElementById('telegram-search-input').value.trim();
    
    if (!searchQuery) {
        alert('Please enter a search query');
        return;
    }
    
    const resultBox = document.getElementById('download-result');
    resultBox.style.display = 'block';
    resultBox.className = 'result-box';
    resultBox.innerHTML = '<p>Searching Telegram channel...</p>';
    
    try {
        const response = await fetch(\`\${backendConfig.url}/search-telegram\`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: searchQuery })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Search failed');
        }
        
        const data = await response.json();
        
        if (data.count === 0) {
            resultBox.className = 'result-box';
            resultBox.innerHTML = \`
                <h3>No Results Found</h3>
                <p>No files matching "\${searchQuery}" found in Telegram channel (last 10 days)</p>
            \`;
            return;
        }
        
        resultBox.className = 'result-box success';
        let resultsHTML = \`
            <h3>✓ Search Results</h3>
            <p><strong>Found:</strong> \${data.count} file(s) matching "\${searchQuery}"</p>
            <div style="margin-top: 1rem; max-height: 300px; overflow-y: auto;">
        \`;
        
        data.results.forEach(file => {
            resultsHTML += \`
                <div style="padding: 0.75rem; background: white; border: 1px solid #e0e0e0; border-radius: 4px; margin-bottom: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 500;">\${file.filename}</div>
                            <div style="font-size: 0.85rem; color: #666;">
                                Size: \${(file.size / 1024 / 1024).toFixed(2)} MB | 
                                Uploaded: \${new Date(file.uploaded_at).toLocaleDateString()}
                            </div>
                        </div>
                        <button class="secondary-btn" onclick="downloadFileById('\${file.file_id}', '\${file.filename.replace(/'/g, "\\\\'")}')">Download</button>
                    </div>
                </div>
            \`;
        });
        
        resultsHTML += '</div>';
        resultBox.innerHTML = resultsHTML;
        
    } catch (error) {
        resultBox.className = 'result-box error';
        resultBox.innerHTML = \`
            <h3>✗ Search Failed</h3>
            <p>\${error.message}</p>
        \`;
    }
};

window.downloadFileById = async function(fileId, filename) {
    const resultBox = document.getElementById('download-result');
    resultBox.style.display = 'block';
    resultBox.className = 'result-box';
    resultBox.innerHTML = '<p>Retrieving file from Telegram bot...</p>';
    
    try {
        const downloadUrl = \`\${backendConfig.url}/download/file/\${encodeURIComponent(fileId)}\`;
        const downloadResponse = await fetch(downloadUrl);
        
        if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'File not found');
        }
        
        const blob = await downloadResponse.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        resultBox.className = 'result-box success';
        resultBox.innerHTML = \`
            <h3>✓ Download Complete</h3>
            <p><strong>Filename:</strong> \${filename}</p>
        \`;
    } catch (error) {
        resultBox.className = 'result-box error';
        resultBox.innerHTML = \`
            <h3>✗ Download Failed</h3>
            <p>\${error.message}</p>
        \`;
    }
};

window.testBackendUrl = async function() {
    const url = document.getElementById('backend-url').value.trim();
    const resultDiv = document.getElementById('url-test-result');
    
    if (!url) {
        resultDiv.className = 'test-result error';
        resultDiv.textContent = '❌ Please enter a backend URL';
        return;
    }
    
    resultDiv.className = 'test-result testing';
    resultDiv.textContent = '⏳ Testing connection...';
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(\`\${url}/status\`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            resultDiv.className = 'test-result success';
            resultDiv.innerHTML = \`
                ✓ Backend connected successfully!<br>
                <small>Bot: @\${data.bot_username || 'Unknown'} | Files: \${data.total_files || 0}</small>
            \`;
        } else {
            throw new Error(\`Server returned status \${response.status}\`);
        }
    } catch (error) {
        resultDiv.className = 'test-result error';
        
        if (error.name === 'AbortError') {
            resultDiv.textContent = '❌ Connection timeout - backend not responding';
        } else if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
            resultDiv.innerHTML = \`
                ❌ Cannot reach backend server<br>
                <small>Make sure the backend is running and the URL is correct</small>
            \`;
        } else {
            resultDiv.innerHTML = \`
                ❌ Error: \${error.message}<br>
                <small>Check your bot token and channel configuration</small>
            \`;
        }
    }
};`;

    // Create a README file
    const readmeContent = `# Telegram Cloud Storage

## Quick Start

1. **Install Python dependencies:**
   \`\`\`
   pip install flask flask-cors python-telegram-bot
   \`\`\`

2. **Start the backend:**
   \`\`\`
   python backend.py
   \`\`\`

3. **Open the frontend:**
   - Open \`index.html\` in your web browser

4. **Configure:**
   - Go to Settings tab
   - Set Backend URL to \`http://localhost:5000\` (or your server's IP)
   - Click "Test" to verify connection
   - Click "Save Configuration"

## Your Configuration

- Bot Token: ${botToken}
- Channel: ${channelUsername}
- Port: ${port}

## Important Notes

- Make sure your bot is added as an admin to the Telegram channel
- The channel must be private
- Keep your bot token secret

## Usage

1. **Upload Files**: Go to Upload tab, select a file, and click Upload
2. **Download Files**: Go to Download tab, enter filename to get File ID
3. **View Files**: Check Dashboard for list of all uploaded files

## Troubleshooting

- If connection fails, ensure backend is running: \`python backend.py\`
- Check that firewall allows connections on port ${port}
- Verify bot token and channel username are correct
`;

    // Create download function
    const files = [
        { name: 'backend.py', content: backendCode },
        { name: 'index.html', content: standaloneHTML },
        { name: 'style.css', content: standaloneCSS },
        { name: 'app.js', content: standaloneJS },
        { name: 'README.txt', content: readmeContent }
    ];
    
    // Download each file
    files.forEach(file => {
        const blob = new Blob([file.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
    
    alert('All files downloaded! Check your downloads folder for backend.py, index.html, style.css, app.js, and README.txt');
};

window.saveBackendConfig = function() {
    const config = {
        url: document.getElementById('backend-url').value.trim(),
        botToken: document.getElementById('bot-token').value.trim(),
        channelUsername: document.getElementById('channel-username').value.trim()
    };
    
    if (!config.url) {
        alert('Please enter a backend URL');
        return;
    }
    
    localStorage.setItem('backendConfig', JSON.stringify(config));
    backendConfig = config;
    
    alert('Configuration saved!');
};

function loadBackendConfig() {
    const saved = localStorage.getItem('backendConfig');
    if (saved) {
        backendConfig = JSON.parse(saved);
        document.getElementById('backend-url').value = backendConfig.url || '';
        document.getElementById('bot-token').value = backendConfig.botToken || '';
        document.getElementById('channel-username').value = backendConfig.channelUsername || '';
    }
    
    // Auto-set backend URL if running on same server
    if (!backendConfig.url && window.location.protocol !== 'file:') {
        const autoUrl = `${window.location.protocol}//${window.location.host}`;
        document.getElementById('backend-url').value = autoUrl;
        backendConfig.url = autoUrl;
    }
}

// Test Backend Configuration
window.testBackendUrl = async function() {
    const url = document.getElementById('backend-url').value.trim();
    const resultDiv = document.getElementById('url-test-result');
    
    if (!url) {
        resultDiv.className = 'test-result error';
        resultDiv.textContent = '❌ Please enter a backend URL';
        return;
    }
    
    resultDiv.className = 'test-result testing';
    resultDiv.textContent = '⏳ Testing connection...';
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${url}/status`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            resultDiv.className = 'test-result success';
            resultDiv.innerHTML = `
                ✓ Backend connected successfully!<br>
                <small>Bot: @${data.bot_username || 'Unknown'} | Files: ${data.total_files || 0}</small>
            `;
        } else {
            throw new Error(`Server returned status ${response.status}`);
        }
    } catch (error) {
        resultDiv.className = 'test-result error';
        
        if (error.name === 'AbortError') {
            resultDiv.textContent = '❌ Connection timeout - backend not responding';
        } else if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
            resultDiv.innerHTML = `
                ❌ Cannot reach backend server<br>
                <small>Make sure the backend is running and the URL is correct</small>
            `;
        } else {
            resultDiv.innerHTML = `
                ❌ Error: ${error.message}<br>
                <small>Check your bot token and channel configuration</small>
            `;
        }
    }
};

