"""
Telegram Cloud Storage Backend
This is a template file for reference. 
Use the "Generate Backend Code" button in the web interface to create a customized version.
Compatible with python-telegram-bot v20+ (async)
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from telegram import Bot
import asyncio
import json
import os
from datetime import datetime

app = Flask(__name__, static_folder='.')
CORS(app)

# Configuration - Replace these with your actual values
BOT_TOKEN = "YOUR_BOT_TOKEN_HERE"
CHANNEL_USERNAME = "@your_channel_here"
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
    """Load file database from JSON"""
    with open(DATABASE_FILE, 'r') as f:
        return json.load(f)

def save_database(data):
    """Save file database to JSON"""
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
    """Upload a file to Telegram channel"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file content into memory
        file_content = file.read()
        file.seek(0)  # Reset pointer in case we need it again
        
        # Run async Telegram operation
        async def send_to_telegram():
            from io import BytesIO
            message = await bot.send_document(
                chat_id=CHANNEL_USERNAME,
                document=BytesIO(file_content),
                filename=file.filename,
                caption=f"File: {file.filename}\nUploaded: {datetime.now().isoformat()}"
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
    """Get file information by filename"""
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

@app.route('/download/file/<identifier>', methods=['GET'])
def download_file_content(identifier):
    """Download actual file by filename or file_id from Telegram bot"""
    try:
        from io import BytesIO
        from flask import send_file
        
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
        
        # Download file from Telegram bot
        async def get_file_from_telegram():
            file = await bot.get_file(file_id)
            file_bytes = BytesIO()
            await file.download_to_memory(file_bytes)
            file_bytes.seek(0)
            return file_bytes.read()
        
        file_content = run_async(get_file_from_telegram())
        
        # Send file to user
        return send_file(
            BytesIO(file_content),
            as_attachment=True,
            download_name=filename,
            mimetype='application/octet-stream'
        )
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/files', methods=['GET'])
def list_files():
    """List all uploaded files"""
    try:
        db = load_database()
        return jsonify({
            'success': True,
            'files': db,
            'count': len(db)
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/scan-channel', methods=['POST'])
def scan_channel():
    """Scan channel for files not in database (last 10 days)"""
    try:
        from datetime import timedelta
        
        async def scan_telegram_channel():
            # Get recent messages from channel
            updates = await bot.get_updates(limit=100)
            files_added = []
            
            # Calculate date 10 days ago
            ten_days_ago = datetime.now() - timedelta(days=10)
            
            # Also try getting chat history
            try:
                from telegram import ChatAction
                chat_id = CHANNEL_USERNAME
                
                # Get last 100 messages
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
                # Check if message is within last 10 days
                if hasattr(message, 'date') and message.date:
                    if message.date < ten_days_ago:
                        continue
                
                if hasattr(message, 'document') and message.document:
                    file_id = message.document.file_id
                    filename = message.document.file_name or f"file_{file_id[:8]}"
                    
                    # Check if file_id already exists in database
                    found = False
                    for fname, fdata in db.items():
                        if fdata.get('file_id') == file_id:
                            found = True
                            break
                    
                    if not found:
                        # Add to database
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

@app.route('/search-telegram', methods=['POST'])
def search_telegram():
    """Search files directly in Telegram channel"""
    try:
        data = request.get_json()
        search_query = data.get('query', '').strip().lower()
        
        if not search_query:
            return jsonify({'error': 'No search query provided'}), 400
        
        from datetime import timedelta
        
        async def search_in_telegram():
            # Get recent messages from channel
            updates = await bot.get_updates(limit=100)
            matched_files = []
            
            # Calculate date 10 days ago
            ten_days_ago = datetime.now() - timedelta(days=10)
            
            # Try getting chat history
            try:
                chat_id = CHANNEL_USERNAME
                messages = []
                async for message in bot.get_chat_history(chat_id, limit=100):
                    messages.append(message)
            except:
                messages = []
                for update in updates:
                    if update.message:
                        messages.append(update.message)
            
            for message in messages:
                # Check if message is within last 10 days
                if hasattr(message, 'date') and message.date:
                    if message.date < ten_days_ago:
                        continue
                
                if hasattr(message, 'document') and message.document:
                    filename = message.document.file_name or f"file_{message.document.file_id[:8]}"
                    
                    # Check if search query matches filename
                    if search_query in filename.lower():
                        matched_files.append({
                            'filename': filename,
                            'file_id': message.document.file_id,
                            'size': message.document.file_size,
                            'uploaded_at': message.date.isoformat() if message.date else datetime.now().isoformat()
                        })
            
            return matched_files
        
        results = run_async(search_in_telegram())
        
        return jsonify({
            'success': True,
            'results': results,
            'count': len(results)
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    """Check backend and bot status"""
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
    app.run(host='0.0.0.0', port=5000, debug=True)