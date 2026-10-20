' Launches send-toast.ps1 with the invoking terminal out of the picture (RF-S3).
' Payload text goes to the child on stdin from a file; no event text on any
' command line. The launcher exits immediately and does not wait.
'
' Usage: cscript //nologo launcher.vbs <payloadPath> <resultPath> <scriptPath>
Option Explicit

Dim sh, fso, payloadPath, resultPath, scriptPath, cmd
If WScript.Arguments.Count <> 3 Then
  WScript.Echo "usage: launcher.vbs <payloadPath> <resultPath> <scriptPath>"
  WScript.Quit 2
End If

payloadPath = WScript.Arguments(0)
resultPath = WScript.Arguments(1)
scriptPath = WScript.Arguments(2)

Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(payloadPath) Then
  WScript.Echo "payload not found: " & payloadPath
  WScript.Quit 3
End If

Set sh = CreateObject("WScript.Shell")
cmd = "cmd.exe /c powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """ -ResultPath """ & resultPath & """ < """ & payloadPath & """"
' window style 0 = hidden; bWaitOnReturn False = launcher exits while child runs.
sh.Run cmd, 0, False
WScript.Quit 0
