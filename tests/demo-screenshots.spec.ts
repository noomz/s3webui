import { test, expect } from '@playwright/test';

test.describe('S3 Web Admin Demo Screenshots', () => {
  test('capture demo screenshots of S3 Web UI with MinIO', async ({ page }) => {
    // Set viewport for consistent screenshots
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate to the application (Docker container on port 5175)
    await page.goto('http://localhost:5175');
    await page.waitForLoadState('networkidle');

    // Screenshot 1: Login page
    await page.screenshot({ path: 'screenshots/01-login-page.png', fullPage: true });

    // Login with demo credentials
    await page.fill('input[type="password"]', 'demo-admin-secret');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // Screenshot 2: Main view with files and folders
    await page.screenshot({ path: 'screenshots/02-main-view.png', fullPage: true });

    // Navigate to documents folder
    await page.locator('text=documents').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=project-spec.md', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/03-documents-folder.png', fullPage: true });

    // Back to root
    await page.getByRole('button', { name: 'Root' }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Navigate to images folder
    await page.locator('text=images').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=team-photo.png', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/04-images-folder.png', fullPage: true });

    // Back to root
    await page.getByRole('button', { name: 'Root' }).click();
    await page.waitForLoadState('networkidle');

    // Navigate to reports folder
    await page.locator('text=reports').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/05-reports-folder.png', fullPage: true });

    // Navigate to nested 2024 folder
    await page.locator('text=2024').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=q1-report.csv', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/06-nested-folder.png', fullPage: true });

    // Back to root
    await page.getByRole('button', { name: 'Root' }).click();
    await page.waitForLoadState('networkidle');

    // Navigate to admin page
    await page.goto('http://localhost:5175/admin');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/07-admin-page.png', fullPage: true });

    console.log('All demo screenshots captured successfully!');
  });
});
