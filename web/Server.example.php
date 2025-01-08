<?php

class Server
{
    private $cacheFile = __DIR__ . './cached_ice_servers.json'; // Path to cache file
    private $cacheDuration = 86400; // 24 hours in seconds

    public function index()
    {
        $servers = $this->getCachedIceServers();

        header('Content-Type: Application/json');
        echo json_encode(json_decode($servers)->v->iceServers);
    }

    private function getCachedIceServers()
    {
        // Ensure the cache file exists and is initialized
        $this->ensureCacheFileExists();

        // Use a lock to ensure safe read/write
        $fp = fopen($this->cacheFile, 'c+'); // Open file for reading and writing
        if (!$fp) {
            throw new RuntimeException("Failed to open cache file: {$this->cacheFile}");
        }

        // Acquire a shared lock (read lock)
        if (!flock($fp, LOCK_SH)) {
            fclose($fp);
            throw new RuntimeException("Failed to acquire shared lock on file: {$this->cacheFile}");
        }

        // Check if cache is still valid
        $fileContents = file_get_contents($this->cacheFile);
        $isCacheValid = $fileContents !== false && (time() - filemtime($this->cacheFile)) < $this->cacheDuration;

        // If cache is valid, return the cached content
        if ($isCacheValid && $fileContents) {
            flock($fp, LOCK_UN); // Release the lock
            fclose($fp);
            return $fileContents;
        }

        // Upgrade to an exclusive lock (write lock)
        if (!flock($fp, LOCK_EX)) {
            fclose($fp);
            throw new RuntimeException("Failed to acquire exclusive lock on file: {$this->cacheFile}");
        }

        // Fetch new data and write it to the cache
        $servers = $this->getIceServers();
        if (!$servers || json_decode($servers) === null) {
            flock($fp, LOCK_UN); // Release the lock
            fclose($fp);
            throw new RuntimeException("Failed to fetch ICE server data");
        }

        if (file_put_contents($this->cacheFile, $servers) === false) {
            flock($fp, LOCK_UN); // Release the lock
            fclose($fp);
            throw new RuntimeException("Failed to write to cache file: {$this->cacheFile}");
        }

        flock($fp, LOCK_UN); // Release the lock
        fclose($fp);
        return $servers;
    }

    private function ensureCacheFileExists()
    {
        if (!file_exists($this->cacheFile)) {
            // Get data and write to file
            $servers = $this->getIceServers();

            if (!$servers || json_decode($servers) === null) {
                throw new RuntimeException("Failed to fetch initial ICE server data");
            }

            if (file_put_contents($this->cacheFile, $servers) === false) {
                throw new RuntimeException("Failed to create and initialize cache file: {$this->cacheFile}");
            }
        }
    }

    private function getIceServers()
    {
        $data = ["format" => "urls"];
        $json_data = json_encode($data);

        $curl = curl_init();
        curl_setopt_array($curl, [
            CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Content-Length: " . strlen($json_data)],
            CURLOPT_POSTFIELDS => $json_data,
            CURLOPT_URL => "https://global.xirsys.net/_turn/YOUR-CHANNEL-NAME",//Replace 'YOUR-CHANNEL-NAME' with the name of your xirsys channel
            CURLOPT_USERPWD => "YOUR PASSWORD",
            CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
            CURLOPT_CUSTOMREQUEST => "PUT",
            CURLOPT_RETURNTRANSFER => 1,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_SSL_VERIFYPEER => TRUE
        ]);

        $res = curl_exec($curl);

        if (curl_error($curl)) {
            echo "Curl error: " . curl_error($curl);
        }

        curl_close($curl);

        return $res;
    }
}

$server = new Server;
$server->index();
