
require("dotenv").config();
const puppeteer = require("puppeteer");

// ======================================
// MIXECONIK STORE - TELEGRAM ORDER BOT
// ======================================

const CONFIG = {
    url: process.env.ADMIN_URL,
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,

    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
};

// ======================================
// CSS SELECTORS - CUSTOMIZE THESE
// ======================================

const SELECTORS = {

    // Login form
    username: "REPLACE_USERNAME_SELECTOR",
    password: "REPLACE_PASSWORD_SELECTOR",
    loginButton: "REPLACE_LOGIN_BUTTON_SELECTOR",

    // Orders section
    ordersNav: "REPLACE_ORDERS_MENU_SELECTOR",
    ordersSection: "REPLACE_ORDERS_SECTION_SELECTOR",

    // Each order container
    orderCard: "REPLACE_ORDER_CARD_SELECTOR",

    // Fields inside each order card
    name: "REPLACE_CUSTOMER_NAME_SELECTOR",
    phone: "REPLACE_PHONE_SELECTOR",
    address: "REPLACE_ADDRESS_SELECTOR",
    product: "REPLACE_PRODUCT_SELECTOR",
    price: "REPLACE_PRICE_SELECTOR",
    status: "REPLACE_STATUS_SELECTOR"
};

// ======================================
// TELEGRAM MESSAGE FUNCTION
// ======================================

async function sendTelegram(message) {

    const api =
        `https://api.telegram.org/bot${CONFIG.token}/sendMessage`;

    const response = await fetch(api, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            chat_id: CONFIG.chatId,
            text: message
        })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
        throw new Error(
            "Telegram error: " + JSON.stringify(result)
        );
    }

    console.log("Telegram message sent successfully!");
}

// ======================================
// GET TEXT FROM ELEMENT
// ======================================

function getText(element, selector) {

    const found = element.querySelector(selector);

    return found
        ? found.innerText.trim()
        : "Not available";
}

// ======================================
// MAIN AUTOMATION
// ======================================

async function main() {

    let browser;

    try {

        if (
            !CONFIG.url ||
            !CONFIG.username ||
            !CONFIG.password ||
            !CONFIG.token ||
            !CONFIG.chatId
        ) {
            throw new Error("Missing .env configuration");
        }

        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        const page = await browser.newPage();

        page.setDefaultTimeout(20000);

        console.log("Opening Mixeconik Admin...");

        await page.goto(CONFIG.url, {
            waitUntil: "domcontentloaded"
        });

        // ==================================
        // ADMIN LOGIN
        // ==================================

        console.log("Entering admin credentials...");

        await page.waitForSelector(SELECTORS.username);
        await page.waitForSelector(SELECTORS.password);

        await page.locator(SELECTORS.username)
            .fill(CONFIG.username);

        await page.locator(SELECTORS.password)
            .fill(CONFIG.password);

        await Promise.all([
            page.locator(SELECTORS.loginButton).click(),
            page.waitForNavigation({
                waitUntil: "domcontentloaded",
                timeout: 15000
            }).catch(() => null)
        ]);

        console.log("Login submitted.");

        // ==================================
        // OPEN ORDERS SECTION
        // ==================================

        await page.waitForSelector(SELECTORS.ordersNav);

        await page.locator(SELECTORS.ordersNav).click();

        await page.waitForSelector(
            SELECTORS.ordersSection
        );

        console.log("Orders section opened.");

        // ==================================
        // EXTRACT ORDER DETAILS
        // ==================================

        const orders = await page.evaluate((s) => {

            const cards = document.querySelectorAll(
                s.orderCard
            );

            function text(card, selector) {
                const el = card.querySelector(selector);
                return el
                    ? el.innerText.trim()
                    : "Not available";
            }

            return Array.from(cards).map(card => ({
                name: text(card, s.name),
                phone: text(card, s.phone),
                address: text(card, s.address),
                product: text(card, s.product),
                price: text(card, s.price),
                status: text(card, s.status)
            }));

        }, SELECTORS);

        console.log("Orders found:", orders.length);

        // ==================================
        // SEND ORDER DETAILS TO TELEGRAM
        // ==================================

        if (orders.length === 0) {

            console.log("No orders found.");

        } else {

            for (let i = 0; i < orders.length; i++) {

                const order = orders[i];

                const message = `
🛒 MIXECONIK STORE
📦 NEW ORDER DETAILS

━━━━━━━━━━━━━━━━

👤 Customer: ${order.name}

📞 Phone: ${order.phone}

🏠 Delivery Address:
${order.address}

🛍 Product: ${order.product}

💰 Price: ${order.price}

📌 Status: ${order.status}

━━━━━━━━━━━━━━━━
Order Number: ${i + 1}

Mixeconik Store
                `.trim();

                await sendTelegram(message);
            }
        }

        console.log("Automation completed.");

    } catch (error) {

        console.error("Automation failed:", error);

    } finally {

        if (browser) {
            await browser.close();
        }
    }
}

main();
