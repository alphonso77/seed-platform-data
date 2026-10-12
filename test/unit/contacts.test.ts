import { expect } from 'chai';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { generateValidUSPhone } from '../../src/generators/contacts';

describe('Contact Generator', () => {
  describe('generateValidUSPhone', () => {
    it('should only return valid numbers in the US region (not NANP territories)', () => {
      for (let i = 0; i < 2000; i++) {
        const phone = generateValidUSPhone();
        const parsed = parsePhoneNumberFromString(phone);
        expect(parsed?.isValid(), phone).to.equal(true);
        expect(parsed?.country, phone).to.equal('US');
      }
    });
  });
});
