plugins { id("com.android.application") }

android {
    namespace = "no.dumbpark.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "no.dumbpark.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 8
        versionName = "0.3.7"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes { release { isMinifyEnabled = false } }
}

dependencies {
    implementation("com.google.android.gms:play-services-location:21.4.0")
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("androidx.work:work-runtime:2.11.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
