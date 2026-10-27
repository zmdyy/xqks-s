"""Real subprocess tests; requires Flask and requests. No paid API is called."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

SOURCE = Path(__file__).resolve().parents[1]


class LauncherTest(unittest.TestCase):
    def test_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix='学情 launch ! & ') as directory:
            folder = Path(directory)
            first = folder / 'repo one'
            second = folder / 'repo two'
            for root in (first, second):
                root.mkdir()
                for name in ('local_launcher.py', 'mineru_server.py'):
                    shutil.copyfile(SOURCE / name, root / name)
                (root / 'index.html').write_text('LOCAL TEST PAGE', encoding='utf-8')
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            env = dict(os.environ, SCORE_LOCAL_PORT=str(port), SCORE_RUNTIME_HOME=str(folder / 'runtime'), SCORE_NO_BROWSER='1')
            url = f'http://127.0.0.1:{port}'
            http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def get(path):
                with http.open(url + path, timeout=2) as response:
                    return response.read()

            def run(action, root=first):
                return subprocess.run([sys.executable, str(root / 'local_launcher.py'), action], env=env, capture_output=True, text=True, timeout=30)

            try:
                # Concurrent clicks must launch a single service instance.
                children = [subprocess.Popen([sys.executable, str(first / 'local_launcher.py'), 'start'], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
                for child in children:
                    out, err = child.communicate(timeout=30)
                    self.assertEqual(child.returncode, 0, (out, err))
                running = json.loads(get('/__local_service__/status'))
                self.assertEqual(get('/index.html'), b'LOCAL TEST PAGE')
                self.assertTrue(json.loads(get('/health'))['same_origin'])
                repeat = run('start')
                self.assertEqual(repeat.returncode, 0, repeat.stderr)
                self.assertEqual(json.loads(get('/__local_service__/status'))['pid'], running['pid'])
                self.assertEqual(run('start', second).returncode, 1, 'another project must not silently serve the wrong code')
                self.assertEqual(run('stop', second).returncode, 1, 'another project cannot stop this instance')
                # No token is exposed by status; unauthenticated shutdown fails.
                self.assertNotIn('token', running)
                req = urllib.request.Request(url + '/__local_service__/stop', method='POST')
                with self.assertRaises(urllib.error.HTTPError) as error:
                    http.open(req)
                self.assertEqual(error.exception.code, 403)
                # Diagnostics follows the existing log. Closing it leaves the server alive.
                diagnostic = subprocess.Popen([sys.executable, str(first / 'local_launcher.py'), 'diagnose'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                time.sleep(.6)
                diagnostic.terminate()
                diagnostic.communicate(timeout=5)
                self.assertEqual(json.loads(get('/__local_service__/status'))['pid'], running['pid'])
                stopped = run('stop')
                self.assertEqual(stopped.returncode, 0, stopped.stderr)
                self.assertEqual(run('stop').returncode, 0, 'stopping an already stopped instance is harmless')
                self.assertFalse(list((folder / 'runtime').rglob('service.json')))
                logs = list((folder / 'runtime').rglob('service.log'))
                self.assertTrue(logs)
                self.assertIn('GET /health', logs[0].read_text(encoding='utf-8'))
                # Restart after graceful shutdown.
                self.assertEqual(run('start').returncode, 0)
                self.assertNotEqual(json.loads(get('/__local_service__/status'))['instance'], running['instance'])
            finally:
                run('stop')
            # An unrelated listener must be left alone.
            with socket.socket() as unrelated:
                unrelated.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                unrelated.bind(('127.0.0.1', port))
                unrelated.listen()
                rejected = run('start')
                self.assertEqual(rejected.returncode, 1)
                self.assertIn(str(port), rejected.stderr)
                self.assertEqual(run('stop').returncode, 1)

    def test_windows_entries(self):
        script = (SOURCE / 'start_system.vbs').read_text()
        self.assertIn('pythonw.exe', script)
        self.assertIn('0, False', script)
        self.assertIn('setup_local.bat', script)
        for name in ('start_local.bat', 'diagnose_local.bat', 'stop_local.bat', 'setup_local.bat'):
            text = (SOURCE / name).read_text()
            self.assertIn('DisableDelayedExpansion', text, 'paths containing ! must be safe')
            self.assertNotIn('taskkill', text.lower())
        setup = (SOURCE / 'setup_local.bat').read_text()
        self.assertIn('requirements-mineru.txt', setup)
        self.assertNotIn('mineru_server.py', setup, 'installation does not block on a foreground server')


if __name__ == '__main__':
    unittest.main()
