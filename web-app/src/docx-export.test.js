import {expect,it} from 'vitest';
import {markdownToDocx} from './docx-export.js';
it('creates a DOCX with structural content and native math',async()=>{const blob=await markdownToDocx('# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\n\\frac{1}{2}\n$$','Test');expect(blob.type).toContain('officedocument');expect(blob.size).toBeGreaterThan(1000);});
it('supports explicit source-page breaks',async()=>{const flowing=await markdownToDocx('One\n\n<!-- page: 2 -->\n\nTwo','Test');const paged=await markdownToDocx('One\n\n<!-- page: 2 -->\n\nTwo','Test',{pageBreaks:true});expect(paged.size).toBeGreaterThan(flowing.size);});
