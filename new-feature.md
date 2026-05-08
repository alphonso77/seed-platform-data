# New Feature

* feature is an add on, leave the current features as they are, they work well
* purpose: a type of simulation test of an external identiy resolution system (called Fratelli Software Organic Intelligence)
* re-use of existing code is fine, but the existing feature set should remain intact
* supports multiple runs where it will generate the data, and save artifacts in the file system (see suggested dir org below)
* records in the dirty versions belong to a single individual

## Each Simulation Run Does This

* create an 'answer key' data set, very similar to the small, medium, large fake data generation engine
    - could probably re-use code for this part
    - user can choose small/medium/large in the same way
    - this will be the 'grading criteria' used to determine the pass/fail of Organic Intelligence
* create three dirty versions of the 'answer key', for HubSpot, Stripe, and Shopify
    - each version has intentionally fragmeted, or duplicated records
* generate a record-level pass/fail report given the manually provided output of Organic Intelligence

# User Flow

1) the user chooses small/medium/large and gets two checkboxes: fragmentation, and duplication
2) using the input parameters, the system randomly generates a Stripe, Hubspot, and Shopify version of the data
    - the system randomly fragments and/or duplicates records in each data set
    - fragmentation examples:
        * HubSpot version may have email and phone, Stripe version just has email
        * Stripe version may have phone only (matching a corresponding hubspot record with the same phone)
    - duplication examples
        * Stripe allows duplicate emails, so two records, same email, different attributes like company or address
        * **nice-to-have:** HubSpot dedupes on email, but a more sophisticated type of duplicate can occur
            - two records with different emails, but the same phone number
            - Real person (HubSpot) has two different email addresses, but the same phone number
            - stripe version: 
        * **nice-to-have:** Shopify dedupes on phone and email, there could be multiple records representing the same real person
            - record 1: has the individuals phone (but not email)
            - record 2: has the individuals email (but not phone)
3) the user can upload each version to each platform (nice to have, make this one step for the user, then the system just uploads all three)
4) once Organic Intelligence is complete, the user should be able to upload a .csv version result set
5) the system compares the 'answer key' to the result set and generates a line-by line report indicating pass/fail
6) the system saves all of the records to the file system in `/simulation-runs/<date-time-of-run>`, files being:
    - the 'answer key'
    - each version of the dirty data (Stripe, Shopify, HubSpot)
    - the .csv from Organic Intelligence
    - the pass/fail report

# Organic Intelligence Data Set

See `data-lake-ex.csv` for an example of OI output.

Here's the query that will generate the OI data. OI is supposed to re-stitch the fragmented data, and group duplicates.

Each `dna_record_id` represents what OI believes to be an individual. So, the intentionally fragmented records should have their own row, but the same `dna_record_id`.

```sql
SELECT
    r.id              AS raw_record_id,
    d.id              AS dna_record_id,
    r.org_id,
    r.source_platform,
    r.source_object_type,
    r.source_record_id,
    r.ingested_at,
    r.last_modified_at,
    r.resolved_at,
    r.raw_payload
FROM oi.raw_records r
LEFT JOIN oi.dna_records d
       ON d.org_id = r.org_id
      AND d.raw_record_refs @> jsonb_build_array(
              jsonb_build_object('raw_record_id', r.id::text)
          )
WHERE r.org_id = 'ab0d85c5-b05e-499a-a7b0-06e1541addcf'
ORDER BY r.ingested_at;
```

## Example CSV Output of OI

```csv

```