fx_version 'cerulean'
game 'gta5'

name 'sd-zonecreator'
description 'Zone helper with coordinate copying utilities'
author 'SD'
version '1.0.0'

shared_scripts {
    '@ox_lib/init.lua',
}

client_scripts {
    'client.lua',
}

server_scripts {
    'server.lua',
}

ui_page 'web/build/index.html'

files {
    'web/build/index.html',
    'web/build/assets/*.css',
    'web/build/assets/*.js',
    'web/build/assets/*.jpg',
    'web/build/assets/*.png',
    'locales/*.json', -- fork patch: labels of the edit / pick sessions (ox_lib locale, `ox:locale`)
}

lua54 'yes'
