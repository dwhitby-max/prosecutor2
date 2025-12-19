import { describe, it, expect } from 'vitest';
import { validateStatuteContent, isValidStatuteText, isValidStatuteTextAny, isValidStatuteTextWvc } from './statutes';

describe('validateStatuteContent', () => {
  describe('rejects navigation HTML', () => {
    it('rejects text shorter than 400 characters', () => {
      const shortText = 'This is a short text that should be rejected.';
      const result = validateStatuteContent('58-37-8', shortText);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too short');
    });

    it('rejects text with 3+ navigation keywords', () => {
      const navText = `
        Find a Bill - House Bills - Senate Bills - legislative schedule
        This is navigation content that should not be cached.
        Session Information - Legislative Meetings - Interim Meetings
        Some padding text to make it longer than 400 characters.
        More padding text here to ensure we hit the length minimum.
        Even more padding to be safe and thorough.
        Additional filler to exceed four hundred characters total.
        More filler text here for the length requirement.
      `;
      const result = validateStatuteContent('58-37-8', navText);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('navigation');
    });

    it('detects navigation phrase: Find a Bill', () => {
      const text = `
        Find a Bill - House Bills - Senate Bills
        Some padding text to make it longer than 400 characters.
        More padding text here to ensure we hit the length minimum.
        Even more padding to be safe and thorough.
        Additional text for length requirements in the test.
        More filler content to exceed four hundred chars.
        Final padding text for the minimum length check.
      `;
      const result = validateStatuteContent('test', text);
      expect(result.valid).toBe(false);
    });

    it('detects navigation phrase: House Bills', () => {
      const text = `
        House Bills - Senate Bills - Session Information
        Some padding text to make it longer than 400 characters.
        More padding text here to ensure we hit the length minimum.
        Even more padding to be safe and thorough.
        Additional text for length requirements in the test.
        More filler content to exceed four hundred chars.
        Final padding text for the minimum length check.
      `;
      const result = validateStatuteContent('test', text);
      expect(result.valid).toBe(false);
    });
  });

  describe('accepts valid statute text', () => {
    it('accepts text with statutory structure markers', () => {
      const validStatute = `
        58-37-8. Prohibited acts -- Penalties.
        (1) Prohibited acts A -- Penalties and reporting:
          (a) Except as authorized by this chapter, and under circumstances not amounting to a violation
          of Section 58-37-8.1, it is unlawful for a person to knowingly and intentionally:
            (i) produce, manufacture, or dispense, or to possess with intent to produce, manufacture,
            or dispense, a controlled or counterfeit substance;
            (ii) distribute a controlled or counterfeit substance, or to agree, consent, offer, or
            arrange to distribute a controlled or counterfeit substance;
        (2) Any person convicted of violating Subsection (1)(a) with respect to:
          (a) a substance classified in Schedule I or II, a controlled substance analog, or 
          gammahydroxybutyric acid as listed in Schedule III is guilty of a second degree felony
          (b) Additional provisions for penalties and sentencing requirements.
      `;
      const result = validateStatuteContent('58-37-8', validStatute);
      expect(result.valid).toBe(true);
    });

    it('accepts text with subsection markers (1), (a), (i)', () => {
      const textWithMarkers = `
        Some legal text that contains:
        (1) First main section with requirements and additional details
          (a) First subsection with specific details about the requirements
          (b) Second subsection with more information about compliance
        (2) Second main section with enforcement provisions
          (a) Subsection details here explaining the enforcement mechanisms
        (3) Third main section about penalties and sanctions
        This text is long enough to pass the 400 char minimum and contains statutory markers.
        Additional text to ensure we exceed the minimum length requirement.
      `;
      const result = validateStatuteContent('76-5-109', textWithMarkers);
      expect(result.valid).toBe(true);
    });

    it('accepts text with legal keywords AND subsection markers', () => {
      const textWithLegalKeywords = `
        (1) A person who commits this offense shall be guilty of a misdemeanor.
        It is unlawful for any person to knowingly engage in prohibited conduct.
        (a) The penalty for violation of this section may include imprisonment.
        (b) Any person convicted under this statute shall be subject to fines.
        (2) This section applies to all persons within the jurisdiction.
        Additional text to meet the minimum length requirement for validation.
        More content here to ensure we exceed four hundred characters total.
        Final padding to meet the 400 character minimum requirement.
      `;
      const result = validateStatuteContent('test', textWithLegalKeywords);
      expect(result.valid).toBe(true);
    });
  });

  describe('minimum length enforcement', () => {
    it('rejects text exactly at 400 characters', () => {
      const exactlyMinLength = 'x'.repeat(400);
      const result = validateStatuteContent('test', exactlyMinLength);
      expect(result.valid).toBe(false);
    });

    it('accepts text over 400 characters with structure', () => {
      const overMinLength = `
        (1) This is a valid statute section that contains proper legal text.
        (a) It includes subsection markers and exceeds the minimum length.
        (b) The content is structured like real statutory language.
        (2) Second main section with additional requirements.
        All provisions herein shall be enforced according to law.
        (3) Third main section with even more legal requirements.
        (a) Additional subsection with more detailed content.
        (b) Another subsection to ensure we exceed 400 characters.
      `;
      expect(overMinLength.length).toBeGreaterThan(400);
      const result = validateStatuteContent('test', overMinLength);
      expect(result.valid).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = validateStatuteContent('test', '');
      expect(result.valid).toBe(false);
    });

    it('handles whitespace-only string', () => {
      const result = validateStatuteContent('test', '   \n\t   ');
      expect(result.valid).toBe(false);
    });
  });
});

describe('statute text content requirements', () => {
  it('real statute should exceed 400 characters', () => {
    const realStatuteExample = `
      58-37a-5. Unlawful acts.
      (1)(a) It is unlawful for a person to use, or to possess with intent to use, drug 
      paraphernalia to plant, propagate, cultivate, grow, harvest, manufacture, compound, 
      convert, produce, process, prepare, test, analyze, pack, repack, store, contain, 
      conceal, inject, ingest, inhale or otherwise introduce a controlled substance into 
      the human body in violation of this chapter.
      (b) A person who violates Subsection (1)(a) is guilty of a class B misdemeanor.
    `;
    expect(realStatuteExample.length).toBeGreaterThan(400);
  });

  it('real statute should not contain navigation phrases', () => {
    const realStatuteExample = `
      58-37a-5. Unlawful acts.
      (1)(a) It is unlawful for a person to use, or to possess with intent to use, drug 
      paraphernalia to plant, propagate, cultivate, grow, harvest, manufacture, compound.
    `;
    const navPhrases = ['Find a Bill', 'House Bills', 'Senate Bills', 'Skip to content', 
      'Skip to Content', 'Search', 'Menu', 'Home', 'Contact', 'Main Navigation', 'Footer',
      'Breadcrumb', 'Login', 'Sign In', 'All Legislators', 'Find Legislators'];
    navPhrases.forEach(phrase => {
      expect(realStatuteExample).not.toContain(phrase);
    });
  });
});

describe('statute text regression tests (400+ chars, no nav)', () => {
  it('validates min length is now 400 chars', () => {
    const text350 = 'x'.repeat(350) + ' (1) section unlawful';
    const result = validateStatuteContent('test', text350);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('400');
  });

  it('accepts text over 400 chars with proper structure', () => {
    const longValidStatute = `
      58-37-8. Prohibited acts -- Penalties.
      (1) Prohibited acts A -- Penalties and reporting:
        (a) Except as authorized by this chapter, and under circumstances not amounting to a violation
        of Section 58-37-8.1, it is unlawful for a person to knowingly and intentionally:
          (i) produce, manufacture, or dispense, or to possess with intent to produce, manufacture,
          or dispense, a controlled or counterfeit substance;
          (ii) distribute a controlled or counterfeit substance, or to agree, consent, offer, or
          arrange to distribute a controlled or counterfeit substance;
      (2) Any person convicted of violating Subsection (1)(a) with respect to a substance classified
      in Schedule I or II, a controlled substance analog, or gammahydroxybutyric acid as listed
      in Schedule III is guilty of a second degree felony and upon a second or subsequent conviction
      is guilty of a first degree felony.
    `;
    expect(longValidStatute.length).toBeGreaterThan(400);
    const result = validateStatuteContent('58-37-8', longValidStatute);
    expect(result.valid).toBe(true);
  });

  it('rejects navigation chrome even if long', () => {
    const navChrome = `
      Skip to content - Main Navigation - Home - Contact - Search - Menu
      Utah State Legislature - Find a Bill - House Bills - Senate Bills
      Session Information - Legislative Meetings - All Legislators
      Some filler text to make this longer than 400 characters.
      More filler content here to ensure we exceed the minimum length.
      Additional padding text to be absolutely sure about the length.
      Even more content to pad out this navigation example text.
      Final bit of padding to exceed four hundred characters total.
    `;
    expect(navChrome.length).toBeGreaterThan(400);
    const result = validateStatuteContent('test', navChrome);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('navigation');
  });

  it('rejects text containing "skip to content" (critical nav phrase)', () => {
    const navText = `
      Utah Code Section 58-37-8
      Accessibility
      Use the Settings Button to view other accessibility Settings
      Skip to Content
      Settings
      (1) Some padded text here to exceed 400 chars.
      More padding to meet the minimum length requirements.
      Even more padding text to ensure we exceed four hundred chars.
      Additional content to pad this test case properly.
      Final padding to ensure proper test coverage.
    `;
    expect(navText.length).toBeGreaterThan(400);
    const result = validateStatuteContent('58-37-8', navText);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('skip to content');
  });
});

describe('isValidStatuteText helper function', () => {
  it('returns false for null/undefined', () => {
    expect(isValidStatuteText(null)).toBe(false);
    expect(isValidStatuteText(undefined)).toBe(false);
  });

  it('returns false for short text', () => {
    expect(isValidStatuteText('short text')).toBe(false);
  });

  it('returns false for text with "Skip to Content"', () => {
    const badText = 'x'.repeat(450) + ' Skip to Content (1) section';
    expect(isValidStatuteText(badText)).toBe(false);
  });

  it('returns true for valid statute text', () => {
    const validText = `
      58-37-8. Prohibited acts -- Penalties.
      (1) Prohibited acts A -- Penalties and reporting:
        (a) Except as authorized by this chapter, it is unlawful for a person to:
          (i) produce, manufacture, or dispense a controlled substance;
          (ii) distribute a controlled substance;
      (2) Any person convicted of violating Subsection (1)(a) is guilty of a felony.
      (3) Additional provisions for penalties and enforcement.
      (4) More content to ensure we exceed the minimum length requirement.
    `;
    expect(validText.length).toBeGreaterThan(400);
    expect(isValidStatuteText(validText)).toBe(true);
  });
});

describe('critical navigation phrase rejection', () => {
  // NOTE: Generic words like "search", "menu", "home", "contact", "accessibility" were removed
  // because they appear in legitimate legal text (e.g., "search warrant", "home detention")
  const criticalPhrases = [
    'skip to content',
    'skip to main content',
    'accessibility settings',
    'use the settings button',
    'all legislators',
    'find legislators',
    'view bills',
    'find a bill',
    'utah state legislature',
  ];

  criticalPhrases.forEach(phrase => {
    it(`rejects text containing "${phrase}"`, () => {
      const text = `
        58-37-8. Prohibited acts -- Penalties.
        ${phrase}
        (1) Some legal text here with proper structure.
        (a) Subsection with details about the requirements.
        (2) More legal text to pad the length properly.
        Additional content to exceed 400 characters minimum.
        More padding text for the length requirement.
        Even more content to be absolutely sure about length.
      `;
      expect(text.length).toBeGreaterThan(400);
      const result = validateStatuteContent('58-37-8', text);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('critical navigation phrase');
    });
  });

  it('rejects uppercase "SKIP TO CONTENT" (case-insensitive)', () => {
    const text = `
      58-37-8. Prohibited acts -- Penalties.
      SKIP TO CONTENT
      (1) Some legal text here with proper structure and content.
      (a) Subsection with detailed information about the requirements.
      (2) More legal text to pad the length properly with extra words.
      Additional content to exceed 400 characters minimum requirement.
      More padding text for the length requirement in this test case.
      Even more content to ensure we pass the 400 character threshold.
      Final padding text to make absolutely sure this test works right.
    `;
    expect(text.length).toBeGreaterThan(400);
    const result = validateStatuteContent('58-37-8', text);
    expect(result.valid).toBe(false);
  });

  it('rejects mixed case "sKiP tO cOnTeNt" (case-insensitive)', () => {
    const text = `
      58-37-8. Prohibited acts -- Penalties.
      sKiP tO cOnTeNt
      (1) Some legal text here with proper structure and content.
      (a) Subsection with detailed information about the requirements.
      (2) More legal text to pad the length properly with extra words.
      Additional content to exceed 400 characters minimum requirement.
      More padding text for the length requirement in this test case.
      Even more content to ensure we pass the 400 character threshold.
      Final padding text to make absolutely sure this test works right.
    `;
    expect(text.length).toBeGreaterThan(400);
    const result = validateStatuteContent('58-37-8', text);
    expect(result.valid).toBe(false);
  });

  it('rejects uppercase "ACCESSIBILITY SETTINGS" (case-insensitive)', () => {
    const text = `
      58-37-8. Prohibited acts -- Penalties.
      ACCESSIBILITY SETTINGS
      (1) Some legal text here with proper structure and content.
      (a) Subsection with detailed information about the requirements.
      (2) More legal text to pad the length properly with extra words.
      Additional content to exceed 400 characters minimum requirement.
      More padding text for the length requirement in this test case.
      Even more content to ensure we pass the 400 character threshold.
      Final padding text to make absolutely sure this test works right.
    `;
    expect(text.length).toBeGreaterThan(400);
    const result = validateStatuteContent('58-37-8', text);
    expect(result.valid).toBe(false);
  });

  it('isValidStatuteText rejects uppercase nav phrases', () => {
    const badText = `
      SKIP TO CONTENT - FIND A BILL - VIEW BILLS
      (1) Some legal text here with proper structure and content.
      (a) Subsection with detailed information about the requirements.
      (2) More legal text to pad the length properly with extra words.
      Additional content to exceed 400 characters minimum requirement.
      More padding text for the length requirement in this test case.
      Even more content to ensure we pass the 400 character threshold.
    `;
    expect(badText.length).toBeGreaterThan(400);
    expect(isValidStatuteText(badText)).toBe(false);
  });

  // Test that legitimate legal terms pass validation
  it('allows text with legal uses of "search" (e.g., search warrant)', () => {
    const text = `
      58-37-8. Prohibited acts -- Penalties.
      (1) A search warrant may be issued when probable cause exists.
      (a) The officer conducting the search must identify themselves.
      (2) Contact with the defendant must be documented.
      (3) Home detention may be ordered for non-violent offenses.
      More content to ensure we exceed the minimum length requirement.
      Additional padding text for the 400 character threshold test.
    `;
    expect(text.length).toBeGreaterThan(400);
    const result = validateStatuteContent('58-37-8', text);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// REGRESSION TESTS - CRITICAL: DO NOT MODIFY WITHOUT REVIEW
// These tests protect against the navigation HTML leak bug that occurred when
// statute text showed "Search Settings Login" instead of actual code content.
// See replit.md for full documentation of this critical fix.
// ============================================================================

describe('CRITICAL: isValidStatuteTextAny - Jurisdiction-Aware Validation', () => {
  describe('Utah (UT) statutes - strict validation', () => {
    it('MUST reject text under 400 chars for Utah statutes', () => {
      const shortText = '(1) Short statute text. (a) Subsection.';
      expect(isValidStatuteTextAny(shortText, 'UT')).toBe(false);
    });

    it('MUST reject Utah statutes without subsection markers', () => {
      const noMarkers = 'This is a long text without any subsection markers like parentheses with numbers or letters. It just keeps going and going with more text to exceed the minimum length requirement of 400 characters. More padding here. Even more padding text. Additional content to make it long enough. Final padding text here.'.repeat(2);
      expect(noMarkers.length).toBeGreaterThan(400);
      expect(isValidStatuteTextAny(noMarkers, 'UT')).toBe(false);
    });

    it('MUST accept valid Utah statute with markers and length', () => {
      const validUT = `
        58-37-8. Prohibited acts -- Penalties.
        (1) Prohibited acts A -- Penalties and reporting:
          (a) Except as authorized by this chapter, it is unlawful for a person to:
            (i) produce, manufacture, or dispense a controlled substance;
            (ii) distribute a controlled or counterfeit substance;
        (2) Any person convicted of violating Subsection (1)(a) with respect to:
          (a) a substance classified in Schedule I or II is guilty of a felony.
        More content for length requirement padding text here to exceed four hundred chars.
      `;
      expect(validUT.length).toBeGreaterThan(400);
      expect(isValidStatuteTextAny(validUT, 'UT')).toBe(true);
    });
  });

  describe('WVC (West Valley City) statutes - lenient validation', () => {
    it('MUST accept WVC statutes under 400 chars (if over 100)', () => {
      const shortWvc = 'Section 8.1.2. Unlawful acts. Any person found violating this ordinance shall be guilty of a class B misdemeanor. Penalty: up to $500 fine.';
      expect(shortWvc.length).toBeGreaterThan(100);
      expect(shortWvc.length).toBeLessThan(400);
      expect(isValidStatuteTextAny(shortWvc, 'WVC')).toBe(true);
    });

    it('MUST accept WVC statutes without subsection markers', () => {
      const noMarkersWvc = 'Section 8.1.2. Noise Ordinance. Excessive noise between 10pm and 7am is prohibited within city limits. Violators subject to fine.';
      expect(noMarkersWvc.length).toBeGreaterThan(100);
      expect(isValidStatuteTextAny(noMarkersWvc, 'WVC')).toBe(true);
    });

    it('MUST reject WVC statutes under 100 chars', () => {
      const tooShort = 'Section 8.1. Short.';
      expect(tooShort.length).toBeLessThan(100);
      expect(isValidStatuteTextAny(tooShort, 'WVC')).toBe(false);
    });
  });

  describe('CRITICAL: Navigation phrase rejection for ALL jurisdictions', () => {
    const navPhrases = [
      'skip to content',
      'skip to main content',
      'skip to navigation',
      'accessibility settings',
      'use the settings button',
      'all legislators',
      'find legislators',
      'view bills',
      'find a bill',
      'utah state legislature',
      'house bills',
      'senate bills',
    ];

    navPhrases.forEach(phrase => {
      it(`MUST reject Utah statute containing "${phrase}"`, () => {
        const badUT = `
          58-37-8. Prohibited acts -- Penalties.
          ${phrase}
          (1) Some legal text here with proper structure and detailed content.
          (a) Subsection with detailed information about the requirements.
          (b) Another subsection with more requirements and details here.
          (2) More legal text to pad the length properly with extra words.
          Additional content to exceed 400 characters minimum requirement.
          More padding text for the length requirement in this test case.
          Even more content to ensure we pass the 400 character threshold.
          Final padding text to make absolutely sure this test works right.
        `;
        expect(badUT.length).toBeGreaterThan(400);
        expect(isValidStatuteTextAny(badUT, 'UT')).toBe(false);
      });

      it(`MUST reject WVC statute containing "${phrase}"`, () => {
        const badWvc = `Section 8.1.2. Unlawful acts. ${phrase}. Violators subject to fine up to $500. Additional text to exceed the minimum length requirement of 100 characters for WVC statutes.`;
        expect(badWvc.length).toBeGreaterThan(100);
        expect(isValidStatuteTextAny(badWvc, 'WVC')).toBe(false);
      });
    });
  });

  describe('CRITICAL: Real-world navigation HTML rejection', () => {
    it('MUST reject actual le.utah.gov navigation content', () => {
      const realNavHtml = `
        Utah Code Section 58-37-8 
        Accessibility 
        Use the Settings Button to view other accessibility Settings 
        Skip to Content 
        Search 
        Settings 
        Login 
        Search 
        Legislators 
        All Legislators 
        Find Legislators 
        By Session (1896-Current)
      `;
      expect(isValidStatuteTextAny(realNavHtml, 'UT')).toBe(false);
    });

    it('MUST accept actual Utah statute content', () => {
      const realStatute = `
        58-37-8. Prohibited acts -- Penalties.
        (1) Prohibited acts A -- Penalties and reporting:
          (a) Except as authorized by this chapter, and under circumstances not amounting to an offense described in Section 58-37-8.1, trafficking of fentanyl or a fentanyl-related substance, it is unlawful for a person to knowingly and intentionally:
            (i) produce, manufacture, or dispense, or to possess with intent to produce, manufacture, or dispense, a controlled or counterfeit substance;
            (ii) distribute a controlled or counterfeit substance, or to agree, consent, offer, or arrange to distribute a controlled or counterfeit substance;
        (2) Any person convicted of violating Subsection (1)(a) with respect to:
          (a) a substance classified in Schedule I or II, a controlled substance analog, or gammahydroxybutyric acid is guilty of a second degree felony.
      `;
      expect(isValidStatuteTextAny(realStatute, 'UT')).toBe(true);
    });
  });
});

describe('isValidStatuteTextWvc - WVC-specific validation', () => {
  it('accepts short WVC ordinances over 100 chars', () => {
    const wvcOrdinance = 'Section 8.1.2. Noise Ordinance. Excessive noise between 10pm and 7am is prohibited within city limits.';
    expect(wvcOrdinance.length).toBeGreaterThan(100);
    expect(isValidStatuteTextWvc(wvcOrdinance)).toBe(true);
  });

  it('rejects WVC with navigation phrases', () => {
    const wvcWithNav = 'Section 8.1.2. Skip to content. Noise Ordinance.';
    expect(isValidStatuteTextWvc(wvcWithNav)).toBe(false);
  });

  it('rejects very short WVC text under 100 chars', () => {
    expect(isValidStatuteTextWvc('Short')).toBe(false);
  });
});
