import { cleanHtmlTags } from '@/lib/utils';

describe('cleanHtmlTags', () => {
  it('returns an empty string for empty input', () => {
    expect(cleanHtmlTags('')).toBe('');
  });

  it('strips trailing &nbsp; padding (real-world CMS description)', () => {
    const raw =
      '<p>总要近距离去感受它的甜蜜和粗粝……' + ' &nbsp;'.repeat(40) + '</p>';
    expect(cleanHtmlTags(raw)).toBe('总要近距离去感受它的甜蜜和粗粝……');
  });

  it('decodes double-encoded entities', () => {
    expect(cleanHtmlTags('甲&amp;nbsp;&amp;nbsp;乙&amp;amp;丙')).toBe(
      '甲 乙&丙'
    );
  });

  it('handles &nbsp without a semicolon', () => {
    expect(cleanHtmlTags('甲&nbsp&nbsp乙')).toBe('甲 乙');
  });

  it('decodes named, decimal and hex entities', () => {
    expect(
      cleanHtmlTags('&ldquo;笹塚町&rdquo;&hellip; &#26085;&#x5267; &lt;3')
    ).toBe('“笹塚町”… 日剧 <3');
  });

  it('leaves unknown or invalid entities untouched', () => {
    expect(cleanHtmlTags('a &foo; b &#0; c')).toBe('a &foo; b &#0; c');
  });

  it('turns block tags into line breaks and drops inline tags', () => {
    expect(
      cleanHtmlTags(
        '<p>第一段<span style="color:red">重点</span>内容</p><p>第二段<br/>换行</p>'
      )
    ).toBe('第一段重点内容\n第二段\n换行');
  });

  it('strips HTML-escaped tags', () => {
    expect(cleanHtmlTags('&lt;p&gt;简介&lt;/p&gt;')).toBe('简介');
  });

  it('collapses full-width / unicode spaces and trims each line', () => {
    expect(cleanHtmlTags('　　开头  中间 \t 结尾​ \r\n\r\n 下一行 ')).toBe(
      '开头 中间 结尾\n下一行'
    );
  });

  it('removes HTML comments', () => {
    expect(cleanHtmlTags('前<!-- <p>hidden</p> -->后')).toBe('前后');
  });
});
