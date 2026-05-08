import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { parseOiResultCsv, OiCsvParseError } from '../../../src/simulation/csv-parser';

describe('simulation/csv-parser', () => {
  it('parses the example data-lake CSV without error', () => {
    const fixture = path.resolve(__dirname, '../../../data-lake-ex.csv');
    if (!fs.existsSync(fixture)) {
      // Fixture is gitignored in some checkouts; skip rather than fail.
      return;
    }
    const buffer = fs.readFileSync(fixture);
    const rows = parseOiResultCsv(buffer);
    expect(rows.length).to.be.greaterThan(0);

    const first = rows[0];
    expect(first.rawRecordId).to.be.a('string').and.not.empty;
    expect(first.dnaRecordId).to.be.a('string');
    expect(first.sourcePlatform).to.be.oneOf(['stripe', 'hubspot', 'shopify']);
    expect(first.rawPayload).to.be.an('object');
    // raw_payload should have been parsed from a JSON string.
    expect(first.rawPayload).to.have.property('id');
  });

  it('strips the embedded JSON quotes around ISO timestamps', () => {
    const csv = [
      'raw_record_id,dna_record_id,org_id,source_platform,source_object_type,source_record_id,ingested_at,last_modified_at,resolved_at,raw_payload',
      'r1,d1,o1,stripe,customers,cus_x,"""2026-05-08T00:00:01.780Z""","""2026-05-07T17:39:51.000Z""",,"{""id"":""cus_x""}"',
    ].join('\n');
    const [row] = parseOiResultCsv(csv);
    expect(row.ingestedAt).to.equal('2026-05-08T00:00:01.780Z');
    expect(row.lastModifiedAt).to.equal('2026-05-07T17:39:51.000Z');
    expect(row.resolvedAt).to.equal(null);
    expect(row.rawPayload.id).to.equal('cus_x');
  });

  it('treats an empty dna_record_id as null', () => {
    const csv = [
      'raw_record_id,dna_record_id,org_id,source_platform,source_object_type,source_record_id,ingested_at,last_modified_at,resolved_at,raw_payload',
      'r1,,o1,hubspot,contacts,123,,,,"{}"',
    ].join('\n');
    const [row] = parseOiResultCsv(csv);
    expect(row.dnaRecordId).to.equal(null);
  });

  it('returns an empty array on empty input', () => {
    expect(parseOiResultCsv('')).to.deep.equal([]);
  });

  it('throws OiCsvParseError when required columns are missing', () => {
    const csv = 'raw_record_id,dna_record_id\nr1,d1';
    expect(() => parseOiResultCsv(csv)).to.throw(OiCsvParseError, /missing required columns/i);
  });

  it('throws OiCsvParseError when raw_payload is not valid JSON', () => {
    const csv = [
      'raw_record_id,dna_record_id,org_id,source_platform,source_object_type,source_record_id,ingested_at,last_modified_at,resolved_at,raw_payload',
      'r1,d1,o1,stripe,customers,cus_x,,,,"not json"',
    ].join('\n');
    expect(() => parseOiResultCsv(csv)).to.throw(OiCsvParseError, /raw_payload/i);
  });
});
