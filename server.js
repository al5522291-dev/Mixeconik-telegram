
require("dotenv").config();

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const fs = require("fs");
const path = require("path");

// ======================================
// MIXECONIK STORE - TELEGRAM ORDER BOT
// Checks for new orders every 5 minutes
// ======================================

const ADMIN_URL = process.env.ADMIN_URL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const POLL_INTERVAL_MS =
    Number(process.env.POLL_INTERVAL_MS) || 5 * 60 * 1000;

const SENT_FILE =
    process.env.SENT_ORDERS_FILE ||
    path.join(__dirname, "data", "sent-orders.json");

let browser = null;
let checking = false;
let stopping = false;
let intervalTimer = null;

// --------------------------------------
// Validate environment variables
// --------------------------------------

function validateConfig() {
    const required = {
        ADMIN_URL,
        ADMIN_USERNAME,
        ADMIN_PASSWORD,
        TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID
    };

    const missing = Object.entries(required)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length) {
        throw new Error(
            "Missing environment variables: " + missing.join(", ")
        );
    }

    if (!Number.isFinite(POLL_INTERVAL_MS) || POLL_INTERVAL_MS < 60000) {
        throw new Error("POLL_INTERVAL_MS must be at least 60000.");
    }
}

// --------------------------------------
// Sent order storage
// --------------------------------------

function readSentOrders() {
    try {
        if (!fs.existsSync(SENT_FILE)) {
            return [];
        }

        const data = JSON.parse(
            fs.readFileSync(SENT_FILE, "utf8")
        );

        return Array.isArray(data) ? data.map(String) : [];
    } catch (error) {
        console.error("Could not read sent orders:", error.message);
        return [];
    }
}

function saveSentOrders(ids) {
    const directory = path.dirname(SENT_FILE);

    fs.mkdirSync(directory, { recursive: true });

    const temporaryFile = SENT_FILE + ".tmp";

    fs.writeFileSync(
        temporaryFile,
        JSON.stringify(ids, null, 2),
        "utf8"
    );

    fs.renameSync(temporaryFile, SENT_FILE);
}

// --------------------------------------
// Launch Chromium browser
// --------------------------------------

async function getBrowser() {
    if (browser && browser.connected) {
        return browser;
    }

    console.log("Starting Chromium browser...");

    browser = await puppeteer.launch({
        args: [
            ...chromium.args,
            "--disable-dev-shm-usage"
        ],
        defaultViewport: {
            width: 1366,
            height: 900
        },
        executablePath: await chromium.executablePath(),
        headless: true
    });

    browser.on("disconnected", () => {
        console.log("Browser disconnected.");
        browser = null;
    });

    return browser;
}

// --------------------------------------
// Telegram message sender
// --------------------------------------

async function sendTelegramMessage(message) {
    const url =
        `https://api.telegram.org/bot${9218709475: AAHNpM1_bi3EUkvuMb-7Stu LDxyIVQTGIpk}/sendMessage`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            chat_id: 2042356478,
            text: message
        })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
        throw new Error(
            result.description || "Telegram message failed"
        );
    }

    return result;
}

// --------------------------------------
// Login to admin panel if required
// --------------------------------------

async function loginIfRequired(page) {
    const usernameField = await page.$(
        'input[name="username"]'
    );

    if (!usernameField) {
        return;
    }

    console.log("Admin login required. Logging in...");

    await page.type(
        'input[name="username"]',
        ADMIN_USERNAME
    );

    await page.type(
        'input[type="password"][name="password"]',
        ADMIN_PASSWORD
    );

    await page.click('button[name="login"]');

    await page.waitForFunction(
        () => !document.querySelector('input[name="username"]'),
        { timeout: 20000 }
    ).catch(() => {});

    const stillLogin = await page.$(
        'input[name="username"]'
    );

    if (stillLogin) {
        throw new Error(
            "Admin login failed. Check ADMIN_USERNAME and ADMIN_PASSWORD."
        );
    }

    console.log("Admin login successful.");
}

// --------------------------------------
// Open Order Details section
// --------------------------------------

function getOrdersUrl() {
    const url = new URL(ADMIN_URL);
    url.searchParams.set("section", "orders");
    return url.toString();
}

async function openOrdersPage(page) {
    await page.goto(getOrdersUrl(), {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    await loginIfRequired(page);

    // If login redirected to another page, open orders again.
    if (!page.url().includes("section=orders")) {
        await page.goto(getOrdersUrl(), {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });
    }

    await page.waitForSelector("#ordersSection", {
        timeout: 20000
    });

    await page.waitForSelector("article.order", {
        timeout: 20000
    }).catch(() => {
        // No orders may be present.
    });
}

// --------------------------------------
// Extract order information
// --------------------------------------

async function extractOrders(page) {
    return await page.$$eval("article.order", elements => {
        return elements.map(order => {
            const heading = order.querySelector("h3");

            const title = heading
                ? heading.innerText.trim()
                : "Unknown Order";

            const details = {};

            order.querySelectorAll(".detail").forEach(detail => {
                const labelElement = detail.querySelector("strong");

                if (!labelElement) return;

                const label = labelElement.innerText
                    .replace(/:/g, "")
                    .trim()
                    .toLowerCase();

                const clone = detail.cloneNode(true);
                const strong = clone.querySelector("strong");

                if (strong) {
                    strong.remove();
                }

                details[label] = clone.innerText
                    .replace(/\s+/g, " ")
                    .trim();
            });

            const match = title.match(
                /Order\s*#?\s*([A-Za-z0-9_-]+)/i
            );

            return {
                id: match ? match[1] : title,
                title,
                name: details["customer name"] || "",
                phone: details["phone number"] || "",
                address: details["full address"] || "",
                product: details["product"] || "",
                unitPrice: details["unit price"] || "",
                quantity: details["quantity"] || "",
                total: details["total"] || "",
                payment: details["payment"] || "",
                orderDate: details["order date"] || "",
                status: details["delivery status"] || ""
            };
        });
    });
}

// --------------------------------------
// Format Telegram message
// --------------------------------------

function createTelegramMessage(order) {
    return [
        "📦 NEW MIXECONIK STORE ORDER",
        "",
        `🧾 Order: ${order.title}`,
        "",
        `👤 Customer: ${order.name || "Not available"}`,
        `📞 Phone: ${order.phone || "Not available"}`,
        `📍 Address: ${order.address || "Not available"}`,
        "",
        `🛍 Product: ${order.product || "Not available"}`,
        `💰 Unit Price: ${order.unitPrice || "Not available"}`,
        `🔢 Quantity: ${order.quantity || "Not available"}`,
        `💵 Total: ${order.total || "Not available"}`,
        "",
        `💳 Payment: ${order.payment || "Not available"}`,
        `📅 Order Date: ${order.orderDate || "Not available"}`,
        `🚚 Delivery Status: ${order.status || "Not available"}`
    ].join("\n");
}

// --------------------------------------
// Check for new orders
// --------------------------------------

async function checkNewOrders() {
    if (checking || stopping) {
        return;
    }

    checking = true;

    let page = null;

    try {
        console.log(
            "\nChecking orders:",
            new Date().toISOString()
        );

        const activeBrowser = await getBrowser();

        page = await activeBrowser.newPage();

        await openOrdersPage(page);

        const orders = await extractOrders(page);

        console.log(`Found ${orders.length} order(s).`);

        const sentOrders = new Set(readSentOrders());

        let newCount = 0;

        for (const order of orders) {
            if (stopping) break;

            const orderId = String(order.id);

            if (sentOrders.has(orderId)) {
                continue;
            }

            try {
                const message = createTelegramMessage(order);

                await sendTelegramMessage(message);

                sentOrders.add(orderId);

                // Save immediately after successful delivery.
                saveSentOrders([...sentOrders]);

                newCount++;

                console.log(
                    `Telegram notification sent: ${order.title}`
                );
            } catch (error) {
                console.error(
                    `Failed to send ${order.title}:`,
                    error.message
                );
            }
        }

        console.log(
            `Check completed. New notifications: ${newCount}`
        );

    } catch (error) {
        console.error("Order checking error:", error.message);

    } finally {
        if (page) {
            await page.close().catch(() => {});
        }

        checking = false;
    }
}

// --------------------------------------
// Start 5-minute checking loop
// --------------------------------------

async function startBot() {
    validateConfig();

    console.log("----------------------------------");
    console.log("MIXECONIK STORE TELEGRAM BOT");
    console.log("Automatic order checking started");
    console.log(
        `Interval: ${POLL_INTERVAL_MS / 60000} minutes`
    );
    console.log("----------------------------------");

    // Run once immediately after startup.
    await checkNewOrders();

    // Repeat every configured interval.
    intervalTimer = setInterval(() => {
        checkNewOrders();
    }, POLL_INTERVAL_MS);
}

// --------------------------------------
// Graceful shutdown for Railway
// --------------------------------------

async function shutdown(signal) {
    if (stopping) return;

    console.log(`\nReceived ${signal}. Shutting down...`);

    stopping = true;

    if (intervalTimer) {
        clearInterval(intervalTimer);
    }

    if (browser) {
        await browser.close().catch(() => {});
        browser = null;
    }

    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --------------------------------------
// Run application
// --------------------------------------

startBot().catch(error => {
    console.error("Startup error:", error);
    process.exit(1);
});