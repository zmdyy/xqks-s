Option Explicit
Dim fso, shell, base, py, launcher, code, quote
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = base
quote = Chr(34)
py = fso.BuildPath(base, ".venv\Scripts\pythonw.exe")
launcher = fso.BuildPath(base, "local_launcher.py")
code = 1
If fso.FileExists(py) Then
  code = shell.Run(quote & py & quote & " -c " & quote & "import sys,flask,requests; assert sys.version_info >= (3,10)" & quote, 0, True)
End If
If code <> 0 Then
  code = shell.Run("cmd.exe /d /c setup_local.bat", 1, True)
  If code <> 0 Then
    MsgBox "Setup failed. Please run diagnose_local.bat for details.", 16, "Local service"
    WScript.Quit code
  End If
End If
If Not fso.FileExists(py) Or Not fso.FileExists(launcher) Then
  MsgBox "Please extract the complete package, then run diagnose_local.bat.", 16, "Local service"
  WScript.Quit 1
End If
shell.Run quote & py & quote & " " & quote & launcher & quote & " start", 0, False
