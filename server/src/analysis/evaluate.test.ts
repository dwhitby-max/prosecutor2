import { describe, it, expect } from 'vitest';
import { stripCriminalHistory } from './evaluate';

describe('stripCriminalHistory', () => {
  describe('criminal history keywords', () => {
    it('should remove sentences containing "priors"', () => {
      const input = 'Officer approached the vehicle. Subject has two priors. Vehicle search revealed contraband.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('priors');
      expect(result).toContain('Officer approached the vehicle');
      expect(result).toContain('Vehicle search revealed contraband');
    });

    it('should remove sentences containing "criminal history"', () => {
      const input = 'Officer conducted a traffic stop. Criminal history check revealed prior arrests. Officer searched the vehicle.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('criminal history');
      expect(result).not.toContain('prior arrests');
      expect(result).toContain('Officer conducted a traffic stop');
      expect(result).toContain('Officer searched the vehicle');
    });

    it('should remove sentences containing "BCI"', () => {
      const input = 'Driver was identified. BCI check showed prior offenses. Search of vehicle yielded contraband.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('BCI');
      expect(result).toContain('Driver was identified');
      expect(result).toContain('Search of vehicle yielded contraband');
    });

    it('should remove sentences containing "NCIC"', () => {
      const input = 'Subject was detained. NCIC returned multiple warrants and prior arrests. Officer handcuffed the suspect.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('NCIC');
      expect(result).toContain('Subject was detained');
      expect(result).toContain('Officer handcuffed the suspect');
    });
  });

  describe('prior offense patterns', () => {
    it('should remove sentences with "year + charge" pattern', () => {
      const input = 'Officer observed the suspect. 2022 charge was dismissed. Officer searched the vehicle.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('2022 charge');
      expect(result).toContain('Officer observed the suspect');
      expect(result).toContain('Officer searched the vehicle');
    });

    it('should remove sentences with "convicted in year" pattern', () => {
      const input = 'Subject was cooperative. He was convicted in 2019 for theft. Officer noted his demeanor.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('convicted');
      expect(result).not.toContain('2019');
      expect(result).toContain('Subject was cooperative');
      expect(result).toContain('Officer noted his demeanor');
    });
  });

  describe('colon-separated lists', () => {
    it('should remove criminal history keyword plus following content in same sentence', () => {
      const input = 'Subject has two priors: theft, burglary. Officer searched the vehicle.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('priors');
      expect(result).not.toContain('theft');
      expect(result).not.toContain('burglary');
      expect(result).toContain('Officer searched the vehicle');
    });
  });

  describe('newline-separated lists', () => {
    it('should remove newline-separated prior offense lines', () => {
      const input = `Criminal history shows prior arrests.
Burglary 2022
Theft 2020
Officer searched the vehicle.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Criminal history');
      expect(result).not.toContain('Burglary 2022');
      expect(result).not.toContain('Theft 2020');
      expect(result).toContain('Officer searched the vehicle');
    });
  });

  describe('section-level removal', () => {
    it('should remove entire Criminal History section with colon', () => {
      const input = `Officer's Actions:
Officer conducted a traffic stop on Main Street.

Criminal History:
Subject has multiple prior arrests for theft and burglary.
Convicted in 2019 for DUI.

Officer's Observations:
Vehicle search revealed contraband.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Criminal History');
      expect(result).not.toContain('prior arrests');
      expect(result).not.toContain('theft and burglary');
      expect(result).not.toContain('DUI');
      expect(result).toContain('Officer conducted a traffic stop');
      expect(result).toContain('Vehicle search revealed contraband');
    });

    it('should remove bare Criminal History header without colon', () => {
      const input = `Officer's Actions:
Officer conducted a traffic stop on Main Street.

Criminal History
THEFT 2020
BURGLARY 2018
DUI 2017

Officer's Observations:
Vehicle search revealed contraband.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Criminal History');
      expect(result).not.toContain('THEFT 2020');
      expect(result).not.toContain('BURGLARY 2018');
      expect(result).not.toContain('DUI 2017');
      expect(result).toContain('Officer conducted a traffic stop');
      expect(result).toContain('Vehicle search revealed contraband');
    });
  });

  describe('preserving legitimate content', () => {
    it('should preserve short officer action sentences', () => {
      const input = 'Officer observed suspect run. Suspect was apprehended.';
      const result = stripCriminalHistory(input);
      expect(result).toContain('Officer observed suspect run');
      expect(result).toContain('Suspect was apprehended');
    });

    it('should preserve current case charge references', () => {
      const input = 'Subject was charged with possession of a controlled substance. Officer seized the evidence.';
      const result = stripCriminalHistory(input);
      expect(result).toContain('charged with possession');
      expect(result).toContain('Officer seized the evidence');
    });

    it('should not remove current year references in context of current case', () => {
      const input = 'On December 20, 2025, Officer Smith conducted a traffic stop. The vehicle was searched.';
      const result = stripCriminalHistory(input);
      expect(result).toContain('December 20, 2025');
      expect(result).toContain('Officer Smith conducted a traffic stop');
    });
  });

  describe('Utah-specific charge labels', () => {
    it('should remove Utah-specific charge references with years', () => {
      const input = 'Subject was cooperative. Violation of Protective Order 2017 was dismissed. Officer proceeded with search.';
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Protective Order 2017');
      expect(result).toContain('Subject was cooperative');
      expect(result).toContain('Officer proceeded with search');
    });
  });

  describe('uppercase and mixed format priors', () => {
    it('should remove uppercase prior offense lines like "THEFT 2020"', () => {
      // Using sentence format (not section header) to test line-level filtering
      const input = `Officer approached the vehicle. THEFT 2020. BURGLARY 2018. Officer searched the vehicle.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('THEFT 2020');
      expect(result).not.toContain('BURGLARY 2018');
      expect(result).toContain('Officer approached the vehicle');
      expect(result).toContain('Officer searched the vehicle');
    });

    it('should remove hyphenated uppercase priors like "BURGLARY – 2018"', () => {
      // Testing inline prior offense patterns with hyphen-year format
      const input = `Subject was identified. BURGLARY – 2018. DUI – 2019. Officer noted the subject was cooperative.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('BURGLARY');
      expect(result).not.toContain('DUI');
      expect(result).toContain('Subject was identified');
      expect(result).toContain('Officer noted the subject was cooperative');
    });

    it('should remove slash-delimited priors like "DUI/DWI 2019"', () => {
      // Testing inline prior offense patterns with slash-delimited format
      const input = `Officer conducted search. DUI/DWI 2019. ASSAULT/BATTERY 2017. Officer proceeded with the investigation.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('DUI/DWI');
      expect(result).not.toContain('ASSAULT/BATTERY');
      expect(result).toContain('Officer conducted search');
      expect(result).toContain('Officer proceeded with the investigation');
    });

    it('should remove dispatch-style inline entries', () => {
      // Testing dispatch-style narrative with inline priors
      const input = `Dispatch responded – Theft 2020 – Burglary 2018. Officer resumed patrol.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Theft 2020');
      expect(result).not.toContain('Burglary 2018');
      expect(result).toContain('Officer resumed patrol');
    });

    it('should remove bullet-prefixed prior entries', () => {
      // Testing bullet-prefixed list entries
      const input = `• Theft 2020\n• Burglary 2018\n• DUI 2017\nOfficer searched the vehicle.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Theft 2020');
      expect(result).not.toContain('Burglary 2018');
      expect(result).not.toContain('DUI 2017');
      expect(result).toContain('Officer searched the vehicle');
    });

    it('should remove varied offense names with bullets', () => {
      // Testing less common offense types with bullet prefixes
      const input = `- Sexual Abuse 2014\n- Aggravated Kidnapping 2016\n- RAPE 2010\nOfficer completed the report.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Sexual Abuse 2014');
      expect(result).not.toContain('Aggravated Kidnapping 2016');
      expect(result).not.toContain('RAPE 2010');
      expect(result).toContain('Officer completed the report');
    });

    it('should remove inline offense types with years', () => {
      // Testing inline offense types (no bullet prefix)
      const input = `Record shows: Murder 2015, Kidnapping 2018, Arson 2020. Officer proceeded with investigation.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Murder 2015');
      expect(result).not.toContain('Kidnapping 2018');
      expect(result).not.toContain('Arson 2020');
      expect(result).toContain('Officer proceeded with investigation');
    });

    it('should remove offenses with parenthetical years', () => {
      // Testing offense types with year in parentheses (inline format)
      // Note: "Prior offenses" triggers "prior\s+\w+" keyword, so the entire sentence is removed correctly
      const input = `Record shows Possession (2018), Assault (2019). Officer completed the report.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('Possession');
      expect(result).not.toContain('(2018)');
      expect(result).not.toContain('Assault');
      expect(result).not.toContain('(2019)');
      expect(result).toContain('Officer completed the report');
    });

    it('should remove offenses with prior case numbers', () => {
      // Testing offense types followed by prior case numbers
      const input = `Record shows prior case 2019-12345 for DUI. Officer noted no warrants.`;
      const result = stripCriminalHistory(input);
      expect(result).not.toContain('prior case 2019-12345');
      expect(result).not.toContain('DUI');
      expect(result).toContain('Officer noted no warrants');
    });

    it('should preserve current case numbers in officer actions', () => {
      // Current case identifiers should NOT be removed
      const input = `Officer responded to case 2025-54321 involving a traffic stop.`;
      const result = stripCriminalHistory(input);
      expect(result).toContain('case 2025-54321');
      expect(result).toContain('Officer responded');
      expect(result).toContain('traffic stop');
    });
  });
});
