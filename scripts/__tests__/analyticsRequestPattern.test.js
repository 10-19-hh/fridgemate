import { describe, expect, it } from 'vitest';
import { GOOGLE_ANALYTICS_REQUEST_PATTERN } from '../../e2e/support/analyticsRequestPattern.js';

describe('the consent browser test analytics request boundary', () => {
  it.each([
    'https://www.googletagmanager.com/gtag/js?id=G-TEST',
    'https://www.google-analytics.com/g/collect',
    'https://region1.google-analytics.com/g/collect',
    'https://google-analytics.com/g/collect',
  ])('observes the Google analytics endpoint %s', url => {
    expect(GOOGLE_ANALYTICS_REQUEST_PATTERN.test(url)).toBe(true);
  });

  it.each([
    'https://notgoogle-analytics.com/g/collect',
    'https://fakegoogletagmanager.com/gtag/js',
    'https://google-analytics.com.example.invalid/g/collect',
    'https://example.invalid/https://www.google-analytics.com/g/collect',
    'https://example.invalid/?next=https://www.googletagmanager.com/gtag/js',
    'https://google-analytics.com@example.invalid/g/collect',
    'http://www.google-analytics.com/g/collect',
  ])('does not misclassify the unrelated endpoint %s', url => {
    expect(GOOGLE_ANALYTICS_REQUEST_PATTERN.test(url)).toBe(false);
  });
});
