import { chmod } from "node:fs/promises";
import { spawn } from "node:child_process";

export async function protectPrivatePath(path, directory = false) {
  if (process.platform !== "win32") {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  // Windows ignores POSIX 0600 for DACL protection. No path or secret is
  // interpolated into PowerShell code; the owned path is passed as data.
  const script = `$ErrorActionPreference='Stop'
$target=$env:INVITATION_PRIVATE_PATH
$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$directory=$env:INVITATION_PRIVATE_DIRECTORY -eq '1'
if($directory){$acl=New-Object System.Security.AccessControl.DirectorySecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$acl=New-Object System.Security.AccessControl.FileSecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]::None}
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($owner,$system)){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule)}
if($directory){[System.IO.Directory]::SetAccessControl($target,$acl);$actual=[System.IO.Directory]::GetAccessControl($target)}else{[System.IO.File]::SetAccessControl($target,$acl);$actual=[System.IO.File]::GetAccessControl($target)}
if(-not $actual.AreAccessRulesProtected){throw 'Private ACL not protected'}
foreach($rule in $actual.Access){$sid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]);if($sid -ne $owner -and $sid -ne $system){throw 'Unexpected private ACL identity'}}`;
  await new Promise((done, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          INVITATION_PRIVATE_PATH: path,
          INVITATION_PRIVATE_DIRECTORY: directory ? "1" : "0",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    child.stderr.resume();
    child.once("error", () =>
      reject(Error("Private Windows permissions could not be configured.")),
    );
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(Error("Private Windows permission verification failed.")),
    );
  });
}
