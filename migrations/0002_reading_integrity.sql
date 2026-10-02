ALTER TABLE works_meta ADD COLUMN char_count INTEGER;
ALTER TABLE works_meta ADD COLUMN title_en TEXT;
CREATE INDEX IF NOT EXISTS idx_reads_reader_day ON reads(reader, day);
