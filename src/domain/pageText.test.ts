import { describe, expect, it } from 'vitest';
import { pageText, pageUrl } from './pageText';

describe('pageText', () => {
  it('keeps the words and drops scripts, styles and tags', () => {
    const html = `<html><head><style>.a{color:red}</style><script>var x = "kcal 999";</script></head>
      <body><h1>Tesco Chicken Breast</h1><table><tr><th>Energy</th><td>106kcal</td></tr><tr><td>Protein</td><td>24.0g</td></tr></table></body></html>`;
    const text = pageText(html);
    expect(text).toContain('Tesco Chicken Breast');
    expect(text).toContain('Energy');
    expect(text).toContain('106kcal');
    expect(text).not.toContain('999');
    expect(text).not.toContain('color');
    expect(text).not.toContain('<');
  });

  it('keeps structured data, where some shops put the nutrition', () => {
    const html = `<p>Oats</p><script type="application/ld+json">{"nutrition":{"calories":"375 kcal"}}</script>`;
    expect(pageText(html)).toContain('"calories":"375 kcal"');
  });

  it('decodes entities', () => {
    expect(pageText('<p>Fish &amp; chips &pound;3 &#8211; 5&nbsp;g &#x27;fresh&#x27;</p>')).toBe("Fish & chips £3 – 5 g 'fresh'");
  });

  it('cuts a long page to a window round its first kcal', () => {
    const html = `<p>${'menu '.repeat(5000)}</p><p>Energy 250kcal Protein 9g</p><p>${'footer '.repeat(5000)}</p>`;
    const text = pageText(html, 2000);
    expect(text.length).toBe(2000);
    expect(text).toContain('Energy 250kcal Protein 9g');
  });

  it('cuts a long page with no kcal from its start', () => {
    const text = pageText(`<p>start ${'word '.repeat(2000)}</p>`, 100);
    expect(text.startsWith('start')).toBe(true);
    expect(text.length).toBe(100);
  });
});

describe('pageUrl', () => {
  it('takes a web address, and adds https to a bare one', () => {
    expect(pageUrl(' https://www.tesco.com/groceries/en-GB/products/123 ')?.href).toBe('https://www.tesco.com/groceries/en-GB/products/123');
    expect(pageUrl('tesco.com/p/1')?.href).toBe('https://tesco.com/p/1');
  });

  it('refuses what is not a web page', () => {
    expect(pageUrl('')).toBeNull();
    expect(pageUrl('chicken breast')).toBeNull();
    expect(pageUrl('javascript:alert(1)')).toBeNull();
    expect(pageUrl('file:///etc/passwd')).toBeNull();
    expect(pageUrl('localhost')).toBeNull();
  });
});
