' RemoteExambro Silent Runner
' Menjalankan agent.ps1 tanpa memunculkan jendela CMD / PowerShell hitam di layar peserta

Set objShell = CreateObject("WScript.Shell")
strCurrentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
strCommand = "powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File """ & strCurrentDir & "\agent.ps1"""
objShell.Run strCommand, 0, False
