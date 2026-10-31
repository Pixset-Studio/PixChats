// PixChats Native Windows Integration Module (C# / .NET Win32)
// Обеспечивает нативную регистрацию AppUserModelID, автозапуска при старте Windows
// (HKCU\Software\Microsoft\Windows\CurrentVersion\Run) в фоновом режиме (--autostart-background)
// и поддержку системных уведомлений Windows Action Center и протокола pixchats://.

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace PixsetStudio.PixChats
{
    public static class PixChatsNativeWin
    {
        public const string AppId = "studio.pixset.pixchats";
        public const string AppName = "PixChats";

        [DllImport("shell32.dll", SetLastError = true)]
        private static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string AppID);

        public static void Main(string[] args)
        {
            try
            {
                SetCurrentProcessExplicitAppUserModelID(AppId);
                RegisterAppUserModelIdInRegistry();
                RegisterWindowsStartupBackground();
                RegisterCustomProtocol();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[PixChatsNativeWin] Init warning: " + ex.Message);
            }
        }

        private static void RegisterWindowsStartupBackground()
        {
            string runKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
            string exePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "PixChats.exe");
            if (File.Exists(exePath))
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(runKeyPath))
                {
                    if (key != null)
                    {
                        key.SetValue(AppName, "\"" + exePath + "\" --autostart-background", RegistryValueKind.String);
                    }
                }
            }
        }

        private static void RegisterAppUserModelIdInRegistry()
        {
            string keyPath = @"Software\Classes\AppUserModelId\" + AppId;
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(keyPath))
            {
                if (key != null)
                {
                    key.SetValue("DisplayName", AppName, RegistryValueKind.String);
                    string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico");
                    if (File.Exists(iconPath))
                    {
                        key.SetValue("IconUri", iconPath, RegistryValueKind.String);
                    }
                }
            }
        }

        private static void RegisterCustomProtocol()
        {
            string keyPath = @"Software\Classes\pixchats";
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(keyPath))
            {
                if (key != null)
                {
                    key.SetValue("", "URL:PixChats Protocol", RegistryValueKind.String);
                    key.SetValue("URL Protocol", "", RegistryValueKind.String);
                }
            }
        }
    }
}
