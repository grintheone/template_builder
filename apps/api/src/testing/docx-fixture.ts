import PizZip from 'pizzip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</w:t></w:r></w:p>`;

// Generates real OPC relationships, a styled paragraph, table, header/footer,
// numbering and a small inline PNG; no binary fixture needs to be checked in.
export function createDocxFixture(options: { body?: string; header?: string; footer?: string } = {}): Buffer {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Default Extension="png" ContentType="image/png"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
    <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
    <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  </Types>`);
  zip.file('_rels/.rels', `${XML}<Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `${XML}<Relationships xmlns="${P}">
    <Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/>
    <Relationship Id="rId2" Type="${R}/footer" Target="footer1.xml"/>
    <Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/>
    <Relationship Id="rId4" Type="${R}/numbering" Target="numbering.xml"/>
    <Relationship Id="rId5" Type="${R}/settings" Target="settings.xml"/>
    <Relationship Id="rId6" Type="${R}/image" Target="media/pixel.png"/>
  </Relationships>`);
  const body = options.body ?? `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="285B47"/><w:sz w:val="36"/></w:rPr><w:t>Agreement for [[client_name]]</w:t></w:r></w:p>
    ${paragraph('Prepared for [[client_name]]. Пример соглашения — 合同.')}
    <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Split run: [[client_</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>name]]</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${paragraph('Amount')}</w:tc><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${paragraph('[[amount]] USD')}</w:tc></w:tr></w:tbl>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Unchanged numbered clause.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Pixel"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId6"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  zip.file('word/document.xml', `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  zip.file('word/header1.xml', `${XML}<w:hdr xmlns:w="${W}">${options.header ?? paragraph('CONFIDENTIAL · [[client_name]]')}</w:hdr>`);
  zip.file('word/footer1.xml', `${XML}<w:ftr xmlns:w="${W}">${options.footer ?? paragraph('Prepared for [[client_name]]')}</w:ftr>`);
  zip.file('word/styles.xml', `${XML}<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial Unicode MS"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style></w:styles>`);
  zip.file('word/numbering.xml', `${XML}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
  zip.file('word/settings.xml', `${XML}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/></w:settings>`);
  zip.file('word/media/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=', 'base64'));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
