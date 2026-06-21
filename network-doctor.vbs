Dim scriptDir : scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
CreateObject("Shell.Application").ShellExecute "pythonw.exe", """" & scriptDir & "\network-doctor.py""", scriptDir, "runas", 1
