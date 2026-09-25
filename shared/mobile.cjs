'use strict';

const ORIGIN = 'https://parko.giantleap.no';
const PARTNER = 'trondheimparkering';
const USER_AGENT = 'Android/Cardboard(trondheimparkering-4.11.6)/1.3.39';
const TARGET = 'tieto booking sluppen p40';

class MobileClient {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
    this.token = undefined;
    this.phoneNumber = undefined;
    this.productsService = undefined;
    this.pendingOrderId = undefined;
    this.uncertainAcquisition = false;
  }

  async request(path, { method = 'GET', body, authenticated = false, idempotencyKey } = {}) {
    if (typeof path !== 'string' || !path || /^\w+:/.test(path) || path.includes('..')) {
      throw new Error('SmartPark returned an invalid service path.');
    }
    const url = new URL(path.replace(/^\/+/, ''), `${ORIGIN}/`);
    if (url.origin !== ORIGIN) throw new Error('SmartPark returned an invalid service origin.');
    const headers = {
      'User-Agent': USER_AGENT,
      'X-PartnerId': PARTNER,
      'X-GLTLocale': 'en_NO_trondheimparkering',
      'Content-Type': 'application/json;charset=UTF-8'
    };
    if (authenticated) {
      if (!this.token) throw new Error('Sign in to the SmartPark permit service first.');
      headers['X-Token'] = this.token;
    }
    if (idempotencyKey) headers['X-GLT-IDEMPOTENCY-KEY'] = idempotencyKey;
    const response = await this.fetcher(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || data.resultCode !== 'SUCCESS') {
      throw new Error(`SmartPark permit service returned ${data.errorCode || `HTTP ${response.status}`}.`);
    }
    return data;
  }

  async getChallengeUrl() {
    const data = await this.request('client/challenge');
    const url = new URL(data.url);
    if (url.origin !== ORIGIN || url.pathname !== '/client-challenge.html') {
      throw new Error('SmartPark returned an unexpected challenge page.');
    }
    return url.toString();
  }

  async requestCode(phoneNumber, challengeToken) {
    if (!/^\+?[0-9 ]{8,16}$/.test(phoneNumber)) throw new Error('Enter a valid phone number.');
    if (typeof challengeToken !== 'string' || challengeToken.length < 20) {
      throw new Error('Complete the SmartPark verification challenge first.');
    }
    await this.request('client/suc-request', {
      method: 'POST', body: { phoneNumber, challengeToken }
    });
    this.phoneNumber = phoneNumber;
  }

  async verifyCode(code) {
    if (!this.phoneNumber) throw new Error('Request an SMS code first.');
    if (!/^[0-9]{4,10}$/.test(code)) throw new Error('Enter the SMS code.');
    const data = await this.request('client/suc-verify', {
      method: 'POST', body: { phoneNumber: this.phoneNumber, code }
    });
    if (typeof data.token !== 'string' || !data.token) {
      throw new Error('SmartPark did not return a session token.');
    }
    this.token = data.token;
    const service = data.parkingServices?.[0]?.clientServices?.products;
    this.productsService = service || (await this.request('client/account', { authenticated: true }))
      .parkingServices?.[0]?.clientServices?.products;
    if (!this.productsService?.pathToPermitShops) {
      throw new Error('SmartPark did not expose a permit shop for this account.');
    }
    return true;
  }

  async getTietoVariants() {
    if (!this.productsService?.pathToPermitShops) {
      throw new Error('Sign in to the SmartPark permit service first.');
    }
    const index = await this.request(this.productsService.pathToPermitShops, { authenticated: true });
    const shop = index.shops?.find(item => item.shopType === 'PERMIT' && item.path);
    if (!shop) throw new Error('SmartPark did not list the permit shop.');
    const elementsOf = page => (page.sections || []).flatMap(section =>
      (section.elements || []).map(element => ({ ...element, action: section.action })));
    let page = await this.request(shop.path, { authenticated: true });
    const trondheim = elementsOf(page).find(element =>
      element.action === 'NEXT_PAGE' && element.title === 'Trondheim' && element.path);
    if (!trondheim) throw new Error('SmartPark did not list Trondheim permits.');
    page = await this.request(trondheim.path, { authenticated: true });
    for (let depth = 0; depth < 5; depth++) {
      const elements = elementsOf(page);
      const next = elements.find(element => element.action === 'NEXT_PAGE' &&
        String(element.title || '').trim().toLowerCase() === TARGET && element.path);
      if (next) {
        page = await this.request(next.path, { authenticated: true });
        continue;
      }
      const leaves = elements.filter(element =>
        ['SELECT', 'PURCHASE'].includes(element.action) && element.path);
      const targetLeaves = leaves.filter(element =>
        String(element.title || '').trim().toLowerCase() === TARGET);
      const selected = targetLeaves.length ? targetLeaves : leaves.length === 1 ? leaves : [];
      if (selected.length) {
        const variants = [];
        for (const element of selected) {
          const details = await this.request(element.path, { authenticated: true });
          if (String(details.product?.name || '').trim().toLowerCase() !== TARGET) continue;
          for (const variant of details.product.variants || []) {
            variants.push({ id: variant.id, priceCents: variant.priceCents,
              availability: variant.availability || null,
              formFields: (variant.formFields || []).map(field => ({
                name: field.name, type: field.type, required: field.required
              })) });
          }
        }
        return variants;
      }
      const nextPages = elements.filter(element => element.action === 'NEXT_PAGE' && element.path);
      if (nextPages.length !== 1) break;
      page = await this.request(nextPages[0].path, { authenticated: true });
    }
    throw new Error('SmartPark did not list the Tieto P40 permit.');
  }

  async getMyPermits() {
    if (!this.productsService?.pathToMyPermits) {
      throw new Error('SmartPark did not expose your permits to this session.');
    }
    const data = await this.request(this.productsService.pathToMyPermits, {
      method: 'POST', body: '', authenticated: true
    });
    if (!Array.isArray(data.permits)) throw new Error('SmartPark did not return a permit list.');
    return data.permits;
  }

  async previewOrder(productVariantId, formData) {
    const service = this.productsService;
    if (!service?.pathToRequestOrder || !service?.pathToCalculatePrice) {
      throw new Error('SmartPark did not expose the required availability and price checks.');
    }
    const body = { productVariantId, formData };
    const availability = (await this.request(service.pathToRequestOrder,
      { method: 'POST', body, authenticated: true })).availability;
    const price = (await this.request(service.pathToCalculatePrice,
      { method: 'POST', body, authenticated: true })).price;
    if (!availability) {
      throw new Error('SmartPark did not return availability for the selected date.');
    }
    if (!price) {
      throw new Error('SmartPark did not return a price for the selected date.');
    }
    return { availability, price };
  }

  async acquirePermit(productVariantId, formData, idempotencyKey) {
    if (!this.productsService?.pathToAquirePermit) {
      throw new Error('SmartPark did not expose permit booking to this session.');
    }
    return this.request(this.productsService.pathToAquirePermit, {
      method: 'POST', authenticated: true, idempotencyKey,
      body: { productVariantId, paymentOptionId: null, formData }
    });
  }
}

module.exports = { MobileClient };
