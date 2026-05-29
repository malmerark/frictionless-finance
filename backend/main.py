import psycopg2
from psycopg2.extras import RealDictCursor
import re
import uuid
from datetime import datetime
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=False, 
    allow_methods=["*"], 
    allow_headers=["*"],
)

# 💥 FIX: Cloud IPv4 Pooler (DSN Format)
DB_URL = "host=aws-1-ap-southeast-2.pooler.supabase.com port=5432 dbname=postgres user=postgres.ufyhvefycigthptuaoss password='ja%72mv/y/gF/TY'"

def get_db():
    return psycopg2.connect(DB_URL)

# INITIALIZE CLOUD DB (Multi-Tenant)
conn = get_db()
cursor = conn.cursor()
cursor.execute('''
    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER,
        description TEXT,
        category TEXT,
        is_split BOOLEAN,
        split_amount INTEGER,
        owed_by TEXT,
        created_at TEXT,
        is_settled BOOLEAN DEFAULT false
    )
''')
cursor.execute('''
    CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT PRIMARY KEY,
        total_limit INTEGER,
        food_limit INTEGER,
        fuel_limit INTEGER,
        maint_limit INTEGER
    )
''')
conn.commit()
conn.close()

class TransactionInput(BaseModel):
    text: str

class SettingsInput(BaseModel):
    total_limit: int
    food_limit: int
    fuel_limit: int
    maint_limit: int

# 💥 NEW: Every route now demands the x-user-id from the frontend
@app.post("/api/add")
def add_transaction(data: TransactionInput, x_user_id: str = Header(...)):
    text = data.text.lower()
    i_owe = text.startswith("owe ")

    match = re.search(r'(\d+)\s*k?', text)
    if not match:
        raise HTTPException(status_code=400, detail="Could not find an amount.")

    raw_number = int(match.group(1))
    amount = raw_number * 1000 if 'k' in match.group(0) else raw_number

    owed_by = None
    split_amount = 0
    person_match = re.search(r'@(\w+)(?:\s+(\d+)\s*k?)?', text)

    if person_match:
        owed_by = person_match.group(1).capitalize()
        if i_owe:
            split_amount = -amount 
        elif person_match.group(2):
            custom_amount = int(person_match.group(2))
            full_match_str = person_match.group(0) 
            split_amount = custom_amount * 1000 if 'k' in full_match_str else custom_amount
        else:
            split_amount = int(amount / 2)

    is_split = owed_by is not None
    desc = text.replace(match.group(0), '', 1).strip()
    if i_owe: desc = desc.replace('owe', '', 1).strip()
    if person_match: desc = desc.replace(person_match.group(0), '').strip()
    desc = re.sub(r'#\w+', '', desc).strip()

    if not desc: desc = "General Expense"

    category = "Maintenance ⚙️"
    if '#food' in text or any(w in desc for w in ['soto', 'ayam', 'makan', 'cafe', 'nasi', 'nasgor', 'minum']): category = "Food 🍔"
    elif '#fuel' in text or any(w in desc for w in ['fuel', 'bensin', 'pertamax', 'parkir', 'gojek']): category = "Fuel 🏍️"
    elif '#dorm' in text or any(w in desc for w in ['dorm', 'kos', 'rusunawa', 'listrik', 'laundry']): category = "Dorm 🏠"

    transaction_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()

    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        """INSERT INTO transactions 
        (id, user_id, amount, description, category, is_split, split_amount, owed_by, created_at) 
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (transaction_id, x_user_id, amount, desc, category, is_split, split_amount, owed_by, created_at)
    )
    db.commit()
    db.close()

    return {"status": "success"}

@app.get("/api/transactions")
def get_transactions(x_user_id: str = Header(...)):
    db = get_db()
    cursor = db.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT * FROM transactions WHERE user_id = %s ORDER BY created_at DESC", (x_user_id,))
    rows = cursor.fetchall()
    db.close()
    return rows

@app.put("/api/transactions/{transaction_id}")
def update_transaction(transaction_id: str, data: TransactionInput, x_user_id: str = Header(...)):
    text = data.text.lower()
    i_owe = text.startswith("owe ")

    match = re.search(r'(\d+)\s*k?', text)
    if not match:
        raise HTTPException(status_code=400, detail="Could not find an amount.")

    raw_number = int(match.group(1))
    amount = raw_number * 1000 if 'k' in match.group(0) else raw_number

    owed_by = None
    split_amount = 0
    person_match = re.search(r'@(\w+)(?:\s+(\d+)\s*k?)?', text)

    if person_match:
        owed_by = person_match.group(1).capitalize()
        if i_owe:
            split_amount = -amount 
        elif person_match.group(2):
            custom_amount = int(person_match.group(2))
            full_match_str = person_match.group(0) 
            split_amount = custom_amount * 1000 if 'k' in full_match_str else custom_amount
        else:
            split_amount = int(amount / 2)

    is_split = owed_by is not None
    desc = text.replace(match.group(0), '', 1).strip()
    if i_owe: desc = desc.replace('owe', '', 1).strip()
    if person_match: desc = desc.replace(person_match.group(0), '').strip()
    desc = re.sub(r'#\w+', '', desc).strip()
    if not desc: desc = "General Expense"

    category = "Maintenance ⚙️"
    if '#food' in text or any(w in desc for w in ['soto', 'ayam', 'makan', 'cafe', 'nasi', 'nasgor', 'minum']): category = "Food 🍔"
    elif '#fuel' in text or any(w in desc for w in ['fuel', 'bensin', 'pertamax', 'parkir', 'gojek']): category = "Fuel 🏍️"
    elif '#dorm' in text or any(w in desc for w in ['dorm', 'kos', 'rusunawa', 'listrik', 'laundry']): category = "Dorm 🏠"

    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        UPDATE transactions 
        SET amount = %s, description = %s, category = %s, is_split = %s, split_amount = %s, owed_by = %s
        WHERE id = %s AND user_id = %s
    """, (amount, desc, category, is_split, split_amount, owed_by, transaction_id, x_user_id))
    db.commit()
    db.close()

    return {"status": "success"}

@app.delete("/api/transactions/{transaction_id}")
def delete_transaction(transaction_id: str, x_user_id: str = Header(...)):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM transactions WHERE id = %s AND user_id = %s", (transaction_id, x_user_id))
    db.commit()
    db.close()
    return {"status": "success"}

@app.put("/api/transactions/{transaction_id}/settle")
async def toggle_settle_transaction(transaction_id: str, x_user_id: str = Header(...)):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        UPDATE transactions 
        SET is_settled = NOT is_settled 
        WHERE id = %s AND user_id = %s
    """, (transaction_id, x_user_id))
    db.commit()
    db.close()
    return {"message": "Debt settled status toggled!"}

@app.get("/api/settings")
def get_settings(x_user_id: str = Header(...)):
    db = get_db()
    cursor = db.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT * FROM settings WHERE user_id = %s", (x_user_id,))
    row = cursor.fetchone()

    # 💥 NEW: Auto-generate a fresh profile if this is a brand new user signing up
    if not row:
        cursor.execute(
                "INSERT INTO settings (user_id, total_limit, food_limit, fuel_limit, maint_limit) VALUES (%s, 0, 0, 0, 0)",
                (x_user_id,)
            )
        db.commit()
        cursor.execute("SELECT * FROM settings WHERE user_id = %s", (x_user_id,))
        row = cursor.fetchone()

    db.close()
    return dict(row)

@app.put("/api/settings")
def update_settings(data: SettingsInput, x_user_id: str = Header(...)):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        UPDATE settings 
        SET total_limit = %s, food_limit = %s, fuel_limit = %s, maint_limit = %s 
        WHERE user_id = %s
    """, (data.total_limit, data.food_limit, data.fuel_limit, data.maint_limit, x_user_id))
    db.commit()
    db.close()
    return {"status": "success"}