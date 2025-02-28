// Importar librerías necesarias
require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, ChannelType, PermissionFlagsBits } = require('discord.js');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');

// Configuración del bot
const BOT_NAME = "Lluviatron";
const RAIN_DURATION = 30 * 60 * 1000; // 30 minutos en milisegundos

// Configurar intents y crear cliente
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Obtener token desde variables de entorno
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
    throw new Error("Discord token not found in environment variables");
}

// Variables globales para los navegadores
let rainDriver = null;
let dayNightDriver = null;
let eventsDriver = null;

// Configuración de Chrome
const createUniqueUserDataDir = () => {
    const userDataDir = path.join(process.cwd(), 'chrome_user_data_' + uuid.v4());
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }
    return userDataDir;
};

const getChromeOptions = () => {
    const options = new chrome.Options()
        .addArguments('--headless')
        .addArguments('--no-sandbox')
        .addArguments('--disable-dev-shm-usage')
        .addArguments('--disable-gpu') // Deshabilitar GPU
        .addArguments('--disable-webgl') // Deshabilitar WebGL
        .addArguments('--window-size=1920,1080')
        .addArguments('--disable-blink-features=AutomationControlled')
        .addArguments('--start-maximized')
        .addArguments('--disable-extensions')
        .addArguments(`--user-data-dir=${createUniqueUserDataDir()}`);
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, como Gecko) Chrome/120.0.0.0 Safari/537.36';
    options.addArguments(`user-agent=${userAgent}`);
    return options;
};



// Función para refrescar página
async function refreshPage(driver) {
    try {
        if (driver) {
            await driver.navigate().refresh();
            await driver.wait(until.elementLocated(By.tagName('body')), 10000);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return true;
        } else {
            console.error("Driver is null");
            return false;
        }
    } catch (e) {
        console.error("Error refreshing page:", e);
        return false;
    }
}

// Función de limpieza
async function cleanup() {
    console.log("Cerrando navegadores...");
    try {
        if (rainDriver) await rainDriver.quit();
        if (dayNightDriver) await dayNightDriver.quit();
        if (eventsDriver) await eventsDriver.quit();
    } catch (e) {
        console.error("Error en cleanup:", e);
    }
}

// Inicializar navegadores
async function initializeBrowsers() {
    console.log('Initializing browsers...');
    try {
        rainDriver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(getChromeOptions())
            .build();

        dayNightDriver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(getChromeOptions())
            .build();

       // eventsDriver = await new Builder()
       //     .forBrowser('chrome')
       //     .setChromeOptions(getChromeOptions())
       //     .build();

        // Configurar timeouts
        if (rainDriver) await rainDriver.manage().setTimeouts({ pageLoad: 30000 });
        if (dayNightDriver) await dayNightDriver.manage().setTimeouts({ pageLoad: 30000 });
       // if (eventsDriver) await eventsDriver.manage().setTimeouts({ pageLoad: 30000 });

        // Cargar páginas iniciales
        await loadPages();
    } catch (e) {
        console.error("Error inicializando navegadores:", e);
        await cleanup();
    }
}

async function loadPages() {
    try {
        console.log("Cargando páginas iniciales...");
        if (rainDriver) {
            await rainDriver.get("https://questlog.gg/throne-and-liberty/en/rain-schedule").catch(e => console.error('Error cargando rainDriver:', e));
        }
        if (dayNightDriver) {
            await dayNightDriver.get("https://questlog.gg/throne-and-liberty/en/day-and-night-schedule").catch(e => console.error('Error cargando dayNightDriver:', e));
        }
      //  if (eventsDriver) {
      //      await eventsDriver.get("https://throneandliberty.gameslantern.com/event-calendar?server=70").catch(e => console.error('Error cargando eventsDriver:', e));
      //  }
    } catch (e) {
        console.error("Error cargando páginas:", e);
    }
}

// Funciones auxiliares
function formatTimeDelta(ms, formatType = 'cycle') {
    if (ms === null) return "desconocido";

    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    if (formatType === 'cycle') {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0 || (hours > 0 && seconds > 0)) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
        return parts.join(' ');
    }
}

// Función para verificar el tiempo
async function startTimeCheck() {
    const alerts = {
        rain_start: false,
        rain_end: false,
        night: false,
        day: false,
        next_event: false
    };

    let lastNameChange = null;
    let nameSet = false;

    async function checkTime() {
        try {
            // Establecer nombre inicial del bot
            if (!nameSet) {
                try {
                    const currentTime = new Date();
                    if (!lastNameChange || (currentTime - lastNameChange) > 7200000) {
                        // Note: Discord.js v14 no permite cambiar el username del bot directamente
                        // Se ha removido esta funcionalidad
                        lastNameChange = currentTime;
                        nameSet = true;
                        console.log("Bot name configuration skipped (Discord API limitation)");
                    }
                } catch (e) {
                    console.error("Error setting bot name:", e);
                    nameSet = true;
                }
            }

            // Obtener estados
            const [rainTime, isRaining] = await getRainCounter();
            const [dayNightTime, isDay] = await getDayNightCounter();
            // const [nextEventTime, nextEventName] = await getEventsCounter(); // Comentado

            // Actualizar estado del bot
            let statusText = "";

            if (rainTime !== null) {
                const icon = isRaining ? "☂️" : "☁️";
                const state = isRaining ? "Despejado en" : "Llueve en";
                statusText += `${icon} ${state}: ${formatTimeDelta(rainTime, 'rain')} | `;
            }

            if (isDay !== null) {
                const icon = isDay ? "☀️" : "🌙";
                const state = isDay ? "Noche en" : "Día en";
                statusText += `${icon} ${state}: ${formatTimeDelta(dayNightTime, 'cycle')}`;
            }

            await client.user.setActivity(statusText, { type: ActivityType.Custom });

            // Enviar alertas según sea necesario
            for (const guild of client.guilds.cache.values()) {
                const channel = guild.channels.cache.find(
                    ch => ch.type === ChannelType.GuildText && 
                    ch.permissionsFor(client.user).has(PermissionFlagsBits.SendMessages)
                );

                if (channel) {
                    // Alerta de lluvia
                    if (rainTime && rainTime <= 300000 && !isRaining) { // 5 minutos
                        if (!alerts.rain_start) {
                            await channel.send(`⚠️ ¡Llueve en ${formatTimeDelta(rainTime, 'rain')}!`);
                            alerts.rain_start = true;
                        }
                    } else {
                        alerts.rain_start = false;
                    }

                     
                }
            }

        } catch (e) {
            console.error("Error in checkTime:", e);
        }

        // Programar la siguiente verificación
        setTimeout(checkTime, 30000); // Verificar cada 30 segundos
    }

    // Iniciar el ciclo de verificación
    checkTime();
}

// Funciones de obtención de datos
async function getRainCounter() {
    try {
        if (rainDriver) {
            await refreshPage(rainDriver);
            const elements = await rainDriver.findElements(By.xpath("//*[contains(text(), 'Raining in') or contains(text(), 'Raining for')]"));
            
            for (const element of elements) {
                if (element) {
                    const text = await element.getText();
                    if (!text) continue;

                    if (text.includes('Raining in')) {
                        const match = text.match(/(\d{2}):(\d{2}):(\d{2})|(\d{1,2}):(\d{2})/);
                        if (match) {
                            if (match[1]) {
                                const [hours, minutes, seconds] = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                                return [(hours * 3600 + minutes * 60 + seconds) * 1000, false];
                            } else {
                                const [minutes, seconds] = [parseInt(match[4]), parseInt(match[5])];
                                return [(minutes * 60 + seconds) * 1000, false];
                            }
                        }
                    }

                    if (text.includes('Raining for')) {
                        const match = text.match(/(\d+):(\d+)/);
                        if (match) {
                            const [minutes, seconds] = [parseInt(match[1]), parseInt(match[2])];
                            const elapsed = (minutes * 60 + seconds) * 1000;
                            return [RAIN_DURATION - elapsed, true];
                        }
                    }
                } else {
                    console.error("Element is null");
                }
            }

            return [null, false];
        } else {
            console.error("Driver is null");
            return [null, false];
        }
    } catch (e) {
        console.error("Error en getRainCounter:", e);
        return [null, false];
    }
}

async function getDayNightCounter() {
    try {
        if (dayNightDriver) {
            await refreshPage(dayNightDriver);
            const elements = await dayNightDriver.findElements(By.xpath("//*[contains(text(), 'Night in') or contains(text(), 'Day in')]"));
            
            for (const element of elements) {
                if (element) {
                    const text = await element.getText();
                    if (!text) continue;

                    const isDay = text.includes('Night in');
                    const match = text.match(/(\d{2}):(\d{2}):(\d{2})|(\d{1,2}):(\d{2})/);
                    
                    if (match) {
                        if (match[1]) {
                            const [hours, minutes, seconds] = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                            return [(hours * 3600 + minutes * 60 + seconds) * 1000, isDay];
                        } else {
                            const [minutes, seconds] = [parseInt(match[4]), parseInt(match[5])];
                            return [(minutes * 60 + seconds) * 1000, isDay];
                        }
                    }
                } else {
                    console.error("Element is null");
                }
            }

            return [null, null];
        } else {
            console.error("Driver is null");
            return [null, null];
        }
    } catch (e) {
        console.error("Error en getDayNightCounter:", e);
        return [null, null];
    }
}

// async function getEventsCounter() {
//     try {
//         if (eventsDriver) {
//             await refreshPage(eventsDriver);
//             const elements = await eventsDriver.findElements(
//                 By.xpath("//*[contains(text(), 'Dynamics Events') or contains(text(), 'Field Bosses') or contains(text(), 'Riftstones') or contains(text(), 'Time') or contains(text(), 'Boonstones')]")
//             );

//             const events = [];
//             for (const element of elements) {
//                 if (element) {
//                     const text = await element.getText();
//                     if (text.includes('Time:')) {
//                         const timeStr = text.split('Time: ')[1].trim();
//                         let eventName = await element.findElement(By.xpath("preceding-sibling::*[1]")).getText();
                        
//                         // Traducir nombres de eventos
//                         eventName = eventName
//                             .replace('Field Bosses', 'Bosses de mundo')
//                             .replace('Dynamic Events', 'Eventos dinámicos')
//                             .replace('Riftstones', 'Piedras de grieta')
//                             .replace('Boonstones', 'Piedras de bendición');
                        
//                         events.push([eventName, timeStr]);
//                     }
//                 } else {
//                     console.error("Element is null");
//                 }
//             }

//             if (events.length > 0) {
//                 const currentTime = new Date();
//                 const currentHourMin = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;
                
//                 // Encontrar el próximo evento
//                 const nextEvent = events.find(([_, time]) => time > currentHourMin);
//                 if (nextEvent) {
//                     return [nextEvent[1], nextEvent[0]];
//                 }
//             }

//             return [null, null];
//         } else {
//             console.error("Driver is null");
//             return [null, null];
//         }
//     } catch (e) {
//         console.error("Error en getEventsCounter:", e);
//         return [null, null];
//     }
// }

// Eventos del cliente Discord
client.on('ready', async () => {
    console.log(`Bot conectado como ${client.user.tag}`);
    await initializeBrowsers();
    console.log('Bot is ready and browsers initialized.');
    startTimeCheck(); // Iniciar la verificación de tiempo
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!meteo') {
        const [rainTime, isRaining] = await getRainCounter();
        const [dayNightTime, isDay] = await getDayNightCounter();
        
        const response = [];
        
        if (isDay !== null) {
            response.push(isDay ? "☀️ Es de día" : "🌙 Es de noche");
            const nextCycle = isDay ? "Noche" : "Día";
            if (dayNightTime) {
                response.push(`Faltan ${formatTimeDelta(dayNightTime, 'cycle')} para ${nextCycle}`);
            }
        }
        
        if (rainTime !== null) {
            if (isRaining) {
                response.push("☔ Está lloviendo ahora.");
            } else {
                response.push(`☔ La lluvia comienza en ${formatTimeDelta(rainTime, 'rain')}.`);
            }
        }
        
        await message.channel.send(response.join('\n'));
    }
    
    // if (message.content.toLowerCase() === '!eventos') {
    //     const [nextEventTime, nextEventName] = await getEventsCounter();
    //     if (nextEventTime) {
    //         await message.channel.send(`Próximo evento: ${nextEventName} a las ${nextEventTime}.`);
    //     } else {
    //         await message.channel.send("No hay eventos próximos.");
    //     }
    // }
});

// Manejo de errores y cierre
process.on('SIGINT', async () => {
    console.log('Cerrando bot...');
    await cleanup();
    process.exit(0);
});

// Iniciar el bot
client.login(TOKEN).then(() => {
    console.log('Autenticación exitosa');
}).catch((error) => {
    console.error('Error de autenticación:', error);
});
