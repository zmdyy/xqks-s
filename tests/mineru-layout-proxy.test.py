import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mineru_server as server

class LayoutTests(unittest.TestCase):
    def result(self, files):
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:
            for name,data in files.items(): z.writestr(name,data)
        response=type('Response',(),{'content':buf.getvalue(),'raise_for_status':lambda self:None})()
        return patch.object(server.requests,'get',return_value=response)
    def test_middle_coordinates_and_assets(self):
        data={'pdf_info':[{'page_idx':0,'page_size':[600,800],'para_blocks':[{'bbox':[30,80,500,200],'type':'text'}]}]}
        with self.result({'full.md':'题干','doc_middle.json':json.dumps(data),'doc_content_list.json':'[]'}):
            md,layout=server.extract_precise_result('https://example.invalid/result.zip')
        self.assertEqual(md,'题干');self.assertEqual(layout['format'],'middle_json');self.assertEqual(layout['data'],data)
    def test_content_list(self):
        with self.result({'full.md':'题干','doc_content_list.json':'[{"page_idx":0,"bbox":[1,2,3,4]}]'}):
            _,layout=server.extract_precise_result('https://example.invalid/result.zip')
        self.assertEqual(layout['coordinate_system'],'1000')
    def test_status_result(self):
        with server.app.test_client() as client:
            self.assertEqual(client.get('/health').status_code,200)
            response=client.get('/paper-crop-engine.js')
            self.assertEqual(response.status_code,200)
            response.close()
            self.assertEqual(client.post('/mineru/precise/status',data={'batch_id':'test'}).status_code,400)
            with patch.object(server,'get_precise_row',return_value={'state':'done','full_zip_url':'mock'}),patch.object(server,'extract_precise_result',return_value=('题干',{'format':'middle_json','data':{}})):
                data=client.post('/mineru/precise/status',data={'batch_id':'test','mineru_token':'dummy-test-token'}).get_json()
            self.assertEqual(data['layout']['format'],'middle_json');self.assertEqual(data['state'],'done')

if __name__=='__main__': unittest.main()
