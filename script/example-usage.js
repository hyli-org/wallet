#!/usr/bin/env node

import { registerAccount } from './hyli-wallet.js';

// Example of using the registration function programmatically
async function exampleUsage() {
    console.log("=== Example: Programmatic Account Registration ===\n");
    
    // Configuration
    const config = {
        username: "testuser",
        password: "mypassword123",
        inviteCode: "INVITE123",
        salt: "customsalt",
        enableSessionKey: true
    };
    
    console.log("Configuration:", config);
    console.log("");
    
    try {
        // Register the account
        const result = await registerAccount(
            config.username,
            config.password,
            config.inviteCode,
            config.salt,
            config.enableSessionKey
        );
        
        if (result.success) {
            console.log("✅ Registration successful!");
            console.log("Wallet details:", JSON.stringify(result.wallet, null, 2));
            
            // You can now use the wallet object for other operations
            console.log(`\nAccount address: ${result.wallet.address}`);
            if (result.wallet.sessionKey) {
                console.log(`Session key public: ${result.wallet.sessionKey.publicKey}`);
                console.log(`Session key expires: ${new Date(result.wallet.sessionKey.expiration).toISOString()}`);
            }
        } else {
            console.log("❌ Registration failed:", result.error);
        }
        
    } catch (error) {
        console.error("Error during registration:", error);
    }
}

// Example of batch registration
async function batchRegistration() {
    console.log("\n=== Example: Batch Registration ===\n");
    
    const users = [
        { username: "alice", password: "alicepass123", inviteCode: "INVITE001" },
        { username: "bob", password: "bobpass123", inviteCode: "INVITE002" },
        { username: "charlie", password: "charliepass123", inviteCode: "INVITE003" }
    ];
    
    for (const user of users) {
        console.log(`Registering user: ${user.username}`);
        
        try {
            const result = await registerAccount(
                user.username,
                user.password,
                user.inviteCode,
                undefined, // Use random salt
                false // No session key
            );
            
            if (result.success) {
                console.log(`✅ ${user.username} registered successfully`);
            } else {
                console.log(`❌ ${user.username} failed: ${result.error}`);
            }
            
        } catch (error) {
            console.log(`❌ ${user.username} error: ${error.message}`);
        }
        
        console.log("---");
    }
}

// Example of error handling
async function errorHandlingExample() {
    console.log("\n=== Example: Error Handling ===\n");
    
    // Test with invalid password
    try {
        const result = await registerAccount(
            "testuser",
            "123", // Too short
            "INVITE123"
        );
        
        console.log("Result:", result);
        
    } catch (error) {
        console.log("Caught error:", error.message);
    }
    
    // Test with missing parameters
    try {
        const result = await registerAccount(
            "testuser",
            "", // Empty password
            "INVITE123"
        );
        
        console.log("Result:", result);
        
    } catch (error) {
        console.log("Caught error:", error.message);
    }
}

// Run examples
async function runExamples() {
    // Set environment variables for the examples
    process.env.NODE_BASE_URL = "http://localhost:4321";
    process.env.INDEXER_BASE_URL = "http://localhost:4322";
    process.env.WALLET_API_BASE_URL = "http://localhost:4000";
    
    await exampleUsage();
    await batchRegistration();
    await errorHandlingExample();
    
    console.log("\n=== Examples completed ===");
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runExamples().catch(error => {
        console.error("Example execution failed:", error);
        process.exit(1);
    });
}

export { exampleUsage, batchRegistration, errorHandlingExample };
