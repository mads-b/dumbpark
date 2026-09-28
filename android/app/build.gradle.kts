plugins { id("com.android.application") }

android {
    namespace = "no.dumbpark.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "no.dumbpark.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.3.3"
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
}
