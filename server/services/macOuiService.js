// Normalise MAC for lookup
function normaliseMac(mac) {
    if (!mac) return '';
    return mac.replace(/[:\-\.]/g, '')
        .toUpperCase()
        .slice(0, 6);
}

// Detect randomised/locally administered MAC
function isRandomisedMac(mac) {
    if (!mac) return false;
    const firstByte = parseInt(
        mac.replace(/[:\-]/g, '').slice(0, 2), 16
    );
    return (firstByte & 0x02) !== 0;
}

// OUI map — first 6 chars uppercase → device info
const OUI_MAP = {
    // Apple — iPhones / iPads
    'A45E60': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    'F0DBF8': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '001CBA': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '001D4F': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '001E52': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '001F5B': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '001FF3': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '002312': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '002332': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },
    '00236F': { manufacturer: 'Apple', device_type: 'iphone_ipad', os_guess: 'iOS' },

    // Apple — Mac
    '3C0754': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '000393': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '000502': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '000A27': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '000D93': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '0010FA': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '001124': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '001451': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '0016CB': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },
    '0017F2': { manufacturer: 'Apple', device_type: 'mac', os_guess: 'macOS' },

    // Samsung
    '8CCE4E': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },
    '48137E': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },
    '0000F0': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },
    '000278': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },
    '0007AB': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },
    '00091F': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },
    '000DB5': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },
    '001247': { manufacturer: 'Samsung', device_type: 'android', os_guess: 'Android' },

    // Huawei
    '001882': { manufacturer: 'Huawei', device_type: 'android', os_guess: 'Android' },
    '001E10': { manufacturer: 'Huawei', device_type: 'android', os_guess: 'Android' },
    '0022A1': { manufacturer: 'Huawei', device_type: 'android', os_guess: 'Android' },
    '00259E': { manufacturer: 'Huawei', device_type: 'android', os_guess: 'Android' },
    '00464B': { manufacturer: 'Huawei', device_type: 'android', os_guess: 'Android' },
    '00E0FC': { manufacturer: 'Huawei', device_type: 'android', os_guess: 'Android' },

    // Xiaomi / OPPO / Vivo / OnePlus
    '009E8B': { manufacturer: 'Xiaomi', device_type: 'android', os_guess: 'Android' },
    '143DF2': { manufacturer: 'Xiaomi', device_type: 'android', os_guess: 'Android' },
    '28A183': { manufacturer: 'Xiaomi', device_type: 'android', os_guess: 'Android' },
    '3480B3': { manufacturer: 'Xiaomi', device_type: 'android', os_guess: 'Android' },

    '14230A': { manufacturer: 'OPPO', device_type: 'android', os_guess: 'Android' },
    '24DF6A': { manufacturer: 'OPPO', device_type: 'android', os_guess: 'Android' },
    '40D15A': { manufacturer: 'OPPO', device_type: 'android', os_guess: 'Android' },
    '508A06': { manufacturer: 'OPPO', device_type: 'android', os_guess: 'Android' },

    '0C8C24': { manufacturer: 'Vivo', device_type: 'android', os_guess: 'Android' },
    '28EE52': { manufacturer: 'Vivo', device_type: 'android', os_guess: 'Android' },
    '381C4A': { manufacturer: 'Vivo', device_type: 'android', os_guess: 'Android' },
    '4CC091': { manufacturer: 'Vivo', device_type: 'android', os_guess: 'Android' },

    'A04E04': { manufacturer: 'OnePlus', device_type: 'android', os_guess: 'Android' },
    'C4A8A6': { manufacturer: 'OnePlus', device_type: 'android', os_guess: 'Android' },
    'E0CAB3': { manufacturer: 'OnePlus', device_type: 'android', os_guess: 'Android' },
    'EC8CFB': { manufacturer: 'OnePlus', device_type: 'android', os_guess: 'Android' },

    // Dell
    '001143': { manufacturer: 'Dell', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001422': { manufacturer: 'Dell', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001550': { manufacturer: 'Dell', device_type: 'windows_laptop', os_guess: 'Windows' },
    '0019B9': { manufacturer: 'Dell', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001D09': { manufacturer: 'Dell', device_type: 'windows_laptop', os_guess: 'Windows' },
    '002170': { manufacturer: 'Dell', device_type: 'windows_laptop', os_guess: 'Windows' },

    // HP
    '000E7F': { manufacturer: 'HP', device_type: 'windows_laptop', os_guess: 'Windows' },
    '00110A': { manufacturer: 'HP', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001321': { manufacturer: 'HP', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001438': { manufacturer: 'HP', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001635': { manufacturer: 'HP', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001708': { manufacturer: 'HP', device_type: 'windows_laptop', os_guess: 'Windows' },

    // HP Printers
    '3C4A92': { manufacturer: 'HP', device_type: 'printer', os_guess: null },
    '001083': { manufacturer: 'HP', device_type: 'printer', os_guess: null },

    // Lenovo
    '0012FE': { manufacturer: 'Lenovo', device_type: 'windows_laptop', os_guess: 'Windows' },
    '001FBA': { manufacturer: 'Lenovo', device_type: 'windows_laptop', os_guess: 'Windows' },
    '002381': { manufacturer: 'Lenovo', device_type: 'windows_laptop', os_guess: 'Windows' },
    '00508D': { manufacturer: 'Lenovo', device_type: 'windows_laptop', os_guess: 'Windows' },
    '04E090': { manufacturer: 'Lenovo', device_type: 'windows_laptop', os_guess: 'Windows' },

    // Cisco 
    '00000C': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '000142': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '000143': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '000163': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '000164': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '000196': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '000197': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '0001C7': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },
    '0001C9': { manufacturer: 'Cisco', device_type: 'switch', os_guess: 'IOS' },

    // Ubiquiti
    '00156D': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },
    '002722': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },
    '0418D6': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },
    '18E829': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },
    '24A43C': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },
    '602232': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },
    '788A20': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },
    'F09FC2': { manufacturer: 'Ubiquiti', device_type: 'ap', os_guess: null },

    // Aruba / HPE
    '000B86': { manufacturer: 'Aruba Networks', device_type: 'ap', os_guess: 'ArubaOS' },
    '001A1E': { manufacturer: 'Aruba Networks', device_type: 'ap', os_guess: 'ArubaOS' },
    '04BD88': { manufacturer: 'Aruba Networks', device_type: 'ap', os_guess: 'ArubaOS' },
    '186472': { manufacturer: 'Aruba Networks', device_type: 'ap', os_guess: 'ArubaOS' },

    // Polycom / Cisco VoIP
    '0004F2': { manufacturer: 'Polycom', device_type: 'voip_phone', os_guess: null },
    '00908F': { manufacturer: 'Polycom', device_type: 'voip_phone', os_guess: null },
    '64167F': { manufacturer: 'Polycom', device_type: 'voip_phone', os_guess: null },
    '00036B': { manufacturer: 'Cisco VoIP', device_type: 'voip_phone', os_guess: null },

    // Canon / Epson / Brother
    '000085': { manufacturer: 'Canon', device_type: 'printer', os_guess: null },
    '001E8F': { manufacturer: 'Canon', device_type: 'printer', os_guess: null },
    '000048': { manufacturer: 'Epson', device_type: 'printer', os_guess: null },
    '0026AB': { manufacturer: 'Epson', device_type: 'printer', os_guess: null },
    '001BA9': { manufacturer: 'Brother', device_type: 'printer', os_guess: null },
    '008077': { manufacturer: 'Brother', device_type: 'printer', os_guess: null },

    // Raspberry Pi
    'B827EB': { manufacturer: 'Raspberry Pi', device_type: 'server', os_guess: 'Linux' },
    'DCA632': { manufacturer: 'Raspberry Pi', device_type: 'server', os_guess: 'Linux' },
    'E45F01': { manufacturer: 'Raspberry Pi', device_type: 'server', os_guess: 'Linux' },

    // Microsoft
    '0003FF': { manufacturer: 'Microsoft', device_type: 'windows_laptop', os_guess: 'Windows' },
    '000D3A': { manufacturer: 'Microsoft', device_type: 'windows_laptop', os_guess: 'Windows' },
    '00125A': { manufacturer: 'Microsoft', device_type: 'windows_laptop', os_guess: 'Windows' },
    '00155D': { manufacturer: 'Microsoft', device_type: 'windows_laptop', os_guess: 'Windows' },
    '0017FA': { manufacturer: 'Microsoft', device_type: 'windows_laptop', os_guess: 'Windows' },
};

function lookupMac(macAddress) {
    if (!macAddress) return null;

    // Handle randomised MACs first
    if (isRandomisedMac(macAddress)) {
        return {
            manufacturer: 'Unknown (Randomised MAC)',
            device_type: 'android',   // most common source
            os_guess: 'Android/iOS',
            confidence: 'low',
            source: 'oui',
            note: 'Randomised MAC — OUI lookup not reliable'
        };
    }

    const oui = normaliseMac(macAddress);
    const match = OUI_MAP[oui];

    if (match) {
        return {
            ...match,
            confidence: 'high',
            source: 'oui'
        };
    }

    return null;  // Unknown — let AI handle it
}

module.exports = { lookupMac, isRandomisedMac };
