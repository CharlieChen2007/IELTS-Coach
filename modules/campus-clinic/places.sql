CREATE TABLE IF NOT EXISTS clinic_slot_places (
 slot_id TEXT PRIMARY KEY REFERENCES clinic_slots(id) ON DELETE CASCADE,
 place TEXT NOT NULL
);
