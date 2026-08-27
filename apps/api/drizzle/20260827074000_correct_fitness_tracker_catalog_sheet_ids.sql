DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM nutrition_brands brand
      JOIN nutrition_brand_versions version
        ON version.id = brand.current_version_id
      JOIN nutrition_catalog_source_records wrong_record
        ON wrong_record.id = version.source_record_id
      JOIN nutrition_catalog_sources wrong_source
        ON wrong_source.id = wrong_record.source_id
      JOIN nutrition_catalog_sources correct_source
        ON correct_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:brand'
      JOIN nutrition_catalog_source_records correct_record
        ON correct_record.source_id = correct_source.id
       AND correct_record.external_record_id = wrong_record.external_record_id
     WHERE brand.visibility = 'private'
       AND wrong_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:brand'
       AND (correct_record.checksum IS DISTINCT FROM wrong_record.checksum
         OR correct_record.parser_version IS DISTINCT FROM wrong_record.parser_version)
  ) THEN
    RAISE EXCEPTION 'Conflicting exact Brand provenance already exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM nutrition_foods food
      JOIN nutrition_food_versions version
        ON version.id = food.current_version_id
      JOIN nutrition_catalog_source_records wrong_record
        ON wrong_record.id = version.source_record_id
      JOIN nutrition_catalog_sources wrong_source
        ON wrong_source.id = wrong_record.source_id
      JOIN nutrition_catalog_sources correct_source
        ON correct_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:food'
      JOIN nutrition_catalog_source_records correct_record
        ON correct_record.source_id = correct_source.id
       AND correct_record.external_record_id = wrong_record.external_record_id
     WHERE food.visibility = 'private'
       AND wrong_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:food'
       AND (correct_record.checksum IS DISTINCT FROM wrong_record.checksum
         OR correct_record.parser_version IS DISTINCT FROM wrong_record.parser_version)
  ) THEN
    RAISE EXCEPTION 'Conflicting exact Food provenance already exists';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO nutrition_catalog_sources (key, name)
SELECT
  'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:brand',
  'Fitness Tracker Brands'
WHERE EXISTS (
  SELECT 1
    FROM nutrition_brands brand
    JOIN nutrition_brand_versions version ON version.id = brand.current_version_id
    JOIN nutrition_catalog_source_records record ON record.id = version.source_record_id
    JOIN nutrition_catalog_sources source ON source.id = record.source_id
   WHERE brand.visibility = 'private'
     AND source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:brand'
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO nutrition_catalog_source_records
  (source_id, external_record_id, fetched_at, checksum, parser_version, status,
   raw_snapshot)
SELECT
  correct_source.id,
  wrong_record.external_record_id,
  wrong_record.fetched_at,
  wrong_record.checksum,
  wrong_record.parser_version,
  wrong_record.status,
  wrong_record.raw_snapshot
FROM nutrition_brands brand
JOIN nutrition_brand_versions version ON version.id = brand.current_version_id
JOIN nutrition_catalog_source_records wrong_record
  ON wrong_record.id = version.source_record_id
JOIN nutrition_catalog_sources wrong_source
  ON wrong_source.id = wrong_record.source_id
JOIN nutrition_catalog_sources correct_source
  ON correct_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:brand'
WHERE brand.visibility = 'private'
  AND wrong_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:brand'
ON CONFLICT (source_id, external_record_id) DO NOTHING;
--> statement-breakpoint
UPDATE nutrition_brand_versions version
SET source_record_id = correct_record.id
FROM nutrition_brands brand,
     nutrition_catalog_source_records wrong_record,
     nutrition_catalog_sources wrong_source,
     nutrition_catalog_sources correct_source,
     nutrition_catalog_source_records correct_record
WHERE brand.current_version_id = version.id
  AND brand.visibility = 'private'
  AND wrong_record.id = version.source_record_id
  AND wrong_source.id = wrong_record.source_id
  AND wrong_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:brand'
  AND correct_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:brand'
  AND correct_record.source_id = correct_source.id
  AND correct_record.external_record_id = wrong_record.external_record_id
  AND correct_record.checksum = wrong_record.checksum
  AND correct_record.parser_version = wrong_record.parser_version;
--> statement-breakpoint
INSERT INTO nutrition_catalog_sources (key, name)
SELECT
  'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:food',
  'Fitness Tracker Foods'
WHERE EXISTS (
  SELECT 1
    FROM nutrition_foods food
    JOIN nutrition_food_versions version ON version.id = food.current_version_id
    JOIN nutrition_catalog_source_records record ON record.id = version.source_record_id
    JOIN nutrition_catalog_sources source ON source.id = record.source_id
   WHERE food.visibility = 'private'
     AND source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:food'
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO nutrition_catalog_source_records
  (source_id, external_record_id, fetched_at, checksum, parser_version, status,
   raw_snapshot)
SELECT
  correct_source.id,
  wrong_record.external_record_id,
  wrong_record.fetched_at,
  wrong_record.checksum,
  wrong_record.parser_version,
  wrong_record.status,
  wrong_record.raw_snapshot
FROM nutrition_foods food
JOIN nutrition_food_versions version ON version.id = food.current_version_id
JOIN nutrition_catalog_source_records wrong_record
  ON wrong_record.id = version.source_record_id
JOIN nutrition_catalog_sources wrong_source
  ON wrong_source.id = wrong_record.source_id
JOIN nutrition_catalog_sources correct_source
  ON correct_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:food'
WHERE food.visibility = 'private'
  AND wrong_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:food'
ON CONFLICT (source_id, external_record_id) DO NOTHING;
--> statement-breakpoint
UPDATE nutrition_food_versions version
SET source_record_id = correct_record.id
FROM nutrition_foods food,
     nutrition_catalog_source_records wrong_record,
     nutrition_catalog_sources wrong_source,
     nutrition_catalog_sources correct_source,
     nutrition_catalog_source_records correct_record
WHERE food.current_version_id = version.id
  AND food.visibility = 'private'
  AND wrong_record.id = version.source_record_id
  AND wrong_source.id = wrong_record.source_id
  AND wrong_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000008:food'
  AND correct_source.key = 'fitness_tracker:1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik:2000000006:food'
  AND correct_record.source_id = correct_source.id
  AND correct_record.external_record_id = wrong_record.external_record_id
  AND correct_record.checksum = wrong_record.checksum
  AND correct_record.parser_version = wrong_record.parser_version;
