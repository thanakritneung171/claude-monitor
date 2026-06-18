import { zipSync } from 'fflate';

// ─── Style index constants ────────────────────────────────────────────────────
export const S = {
	DEFAULT:    0,  // normal text
	BOLD:       1,  // bold
	SEC_TITLE:  2,  // bold 13pt + peach bg  (section title)
	COL_HDR:    3,  // bold + blue bg        (table column header)
	STAT_LABEL: 4,  // bold + light peach bg (KV label)
	NUM_COST:   5,  // #,##0.0000
	NUM_INT:    6,  // #,##0
} as const;

export interface XCell { v: string | number | null; s?: number }
export type XRow = XCell[];

export interface XSheet {
	name:        string;
	rows:        XRow[];
	colWidths?:  number[];
	freezeRows?: number;   // freeze top N rows
	autoFilter?: boolean;  // auto-filter on row 1
}

// ─── XML helpers ─────────────────────────────────────────────────────────────
function xe(s: string): string {
	return s
		.replace(/&/g,  '&amp;')
		.replace(/</g,  '&lt;')
		.replace(/>/g,  '&gt;')
		.replace(/"/g,  '&quot;')
		.replace(/\r\n|\r|\n/g, '&#10;');
}

function colLetter(n: number): string {
	let s = '';
	for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26))
		s = String.fromCharCode(64 + ((x - 1) % 26 + 1)) + s;
	return s;
}

const te = new TextEncoder();
const u8 = (s: string) => te.encode(s);

// ─── Main builder ─────────────────────────────────────────────────────────────
export function buildXlsx(sheets: XSheet[]): Uint8Array {
	// Shared string pool (across all sheets)
	const pool: string[] = [];
	const pidx = new Map<string, number>();
	let refs = 0;
	const intern = (v: string): number => {
		let i = pidx.get(v);
		if (i === undefined) { i = pool.length; pool.push(v); pidx.set(v, i); }
		refs++;
		return i;
	};

	// ── build each worksheet XML ─────────────────────────────────
	const sheetXmls: string[] = [];
	for (const sheet of sheets) {
		const rxml: string[] = [];
		for (let r = 0; r < sheet.rows.length; r++) {
			const cx: string[] = [];
			for (let c = 0; c < sheet.rows[r].length; c++) {
				const { v, s } = sheet.rows[r][c];
				const addr = colLetter(c) + (r + 1);
				const sa   = s ? ` s="${s}"` : '';
				if (v === null || v === '') {
					if (s) cx.push(`<c r="${addr}"${sa}/>`);
					continue;
				}
				if (typeof v === 'number') cx.push(`<c r="${addr}"${sa}><v>${v}</v></c>`);
				else cx.push(`<c r="${addr}" t="s"${sa}><v>${intern(v)}</v></c>`);
			}
			if (cx.length) rxml.push(`<row r="${r + 1}">${cx.join('')}</row>`);
		}

		const mc   = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
		const dim  = mc && sheet.rows.length ? `A1:${colLetter(mc - 1)}${sheet.rows.length}` : 'A1';
		const cols = (sheet.colWidths?.length)
			? `<cols>${sheet.colWidths.map((w, i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
			: '';

		// freeze pane
		let sheetViews = '<sheetViews><sheetView workbookViewId="0">';
		if (sheet.freezeRows) {
			const topLeft = `A${sheet.freezeRows + 1}`;
			sheetViews += `<pane ySplit="${sheet.freezeRows}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>`;
			sheetViews += `<selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`;
		}
		sheetViews += '</sheetView></sheetViews>';

		const af = sheet.autoFilter && mc > 0 && sheet.rows.length > 0
			? `<autoFilter ref="A1:${colLetter(mc - 1)}1"/>`
			: '';

		sheetXmls.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dim}"/>
${sheetViews}${cols}
<sheetData>
${rxml.join('\n')}
</sheetData>
${af}
</worksheet>`);
	}

	// ── static XML parts ─────────────────────────────────────────
	const sheetOverrides = sheets
		.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
		.join('\n');

	const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetOverrides}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

	const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

	const sheetElems = sheets
		.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`)
		.join('\n');

	const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetElems}</sheets>
</workbook>`;

	const wbRelEntries = [
		...sheets.map((_, i) => `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`),
		`<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`,
		`<Relationship Id="rId${sheets.length+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
	].join('\n');

	const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${wbRelEntries}
</Relationships>`;

	const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${refs}" uniqueCount="${pool.length}">
${pool.map(s => `<si><t xml:space="preserve">${xe(s)}</t></si>`).join('\n')}
</sst>`;

	// Styles:
	//  Fonts:  0=normal, 1=bold, 2=bold 13pt
	//  Fills:  0=none, 1=gray125, 2=peach #FFE4D2, 3=blue #D9E1F2, 4=light-peach #FFF8F4
	//  Borders:0=none
	//  xf idx: 0=default, 1=bold, 2=sec-title(font2+fill2), 3=col-hdr(font1+fill3),
	//          4=stat-label(font1+fill4), 5=NUM_COST(164), 6=NUM_INT(3)
	const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1">
<numFmt numFmtId="164" formatCode="#,##0.0000"/>
</numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="13"/><name val="Calibri"/><color rgb="FFC05A2B"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFE4D2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF8F4"/></patternFill></fill>
</fills>
<borders count="1">
<border><left/><right/><top/><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
</cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0"   fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0"   fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0"   fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0"   fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="3"   fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
</styleSheet>`;

	// ── assemble ZIP ─────────────────────────────────────────────
	const files: Record<string, Uint8Array> = {
		'[Content_Types].xml':        u8(contentTypes),
		'_rels/.rels':                u8(rootRels),
		'xl/workbook.xml':            u8(workbook),
		'xl/_rels/workbook.xml.rels': u8(wbRels),
		'xl/sharedStrings.xml':       u8(sharedStrings),
		'xl/styles.xml':              u8(styles),
	};
	for (let i = 0; i < sheets.length; i++)
		files[`xl/worksheets/sheet${i+1}.xml`] = u8(sheetXmls[i]);

	return zipSync(files, { level: 6 });
}
