import {
    RouterOutlined,
    DeviceHubOutlined,
    WifiTetheringOutlined,
    DnsOutlined,
    ComputerOutlined,
    LaptopOutlined,
    LaptopMacOutlined,
    PhoneIphoneOutlined,
    PhoneAndroidOutlined,
    LocalPhoneOutlined,
    PrintOutlined,
    DevicesOtherOutlined
} from '@mui/icons-material';

export const DEVICE_TYPES = [
    { value: 'router', label: 'Router' },
    { value: 'switch', label: 'Switch' },
    { value: 'ap', label: 'Access Point' },
    { value: 'server', label: 'Server' },
    { value: 'workstation', label: 'Workstation' },
    { value: 'windows_laptop', label: 'Windows Laptop' },
    { value: 'mac', label: 'Mac (Apple)' },
    { value: 'iphone_ipad', label: 'iPhone / iPad' },
    { value: 'android', label: 'Android Phone' },
    { value: 'voip_phone', label: 'VoIP Phone' },
    { value: 'printer', label: 'Network Printer' },
    { value: 'other', label: 'Other' },
];

export function getDeviceTypeIcon(type) {
    const icons = {
        router: RouterOutlined,
        switch: DeviceHubOutlined,
        ap: WifiTetheringOutlined,
        server: DnsOutlined,
        workstation: ComputerOutlined,
        windows_laptop: LaptopOutlined,
        mac: LaptopMacOutlined,
        iphone_ipad: PhoneIphoneOutlined,
        android: PhoneAndroidOutlined,
        voip_phone: LocalPhoneOutlined,
        printer: PrintOutlined,
        other: DevicesOtherOutlined,
    };
    return icons[type] || DevicesOtherOutlined;
}
